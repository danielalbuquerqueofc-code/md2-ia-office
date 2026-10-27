import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthenticatedDirectorPrincipal,
  type DemandPriority,
  Md2Director,
} from '../src/md2/director.js';
import { type LimitsConfiguration, Md2Limits } from '../src/md2/limits.js';
import { Md2Policy, type PolicyAction, type PolicyGrant } from '../src/md2/policy.js';
import { Md2Queue, type QueueItem } from '../src/md2/queue.js';
import { Md2Storage, type StorageScope } from '../src/md2/storage.js';
import { workerInputFromReservation } from '../src/md2/worker.js';

const scope = { clientId: 'queue-test-client', projectId: 'queue-test-project' };
const zero = { maxAttempts: 0, maxTokens: 0, maxCostMicros: 0 };
const grants: PolicyGrant[] = [
  {
    agentId: 'carlos',
    capability: 'work.review',
    kind: 'internal.analyze',
    requireApproval: false,
  },
  { agentId: 'andre', capability: 'code.draft', kind: 'internal.draft', requireApproval: false },
];
function budgetConfig(target = scope): LimitsConfiguration {
  return {
    scope: { ...target },
    task: { maxAttempts: 10, maxTokens: 1000, maxCostMicros: 1000 },
    agent: { maxAttempts: 100, maxTokens: 10000, maxCostMicros: 10000 },
    project: { maxAttempts: 100, maxTokens: 10000, maxCostMicros: 10000 },
    budget: {
      id: 'queue-test-budget',
      scope: { ...target },
      currency: 'USD',
      maxTokens: 10000,
      maxCostMicros: 10000,
      expiresAt: Date.now() + 3600000,
    },
  };
}

describe('MD2 persistent distribution queue (no execution)', () => {
  let root: string;
  let store: Md2Storage;
  let director: Md2Director;
  let policy: Md2Policy;
  let session: object;
  let principal: AuthenticatedDirectorPrincipal;
  let sequence: number;
  const stores = new Set<Md2Storage>();
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-queue-'));
    store = new Md2Storage({ root, scope });
    stores.add(store);
    await store.initialize();
    session = Object.freeze({ fixture: 'queue-unit-test-only' });
    sequence = 0;
    principal = {
      subjectId: 'queue-test-ceo',
      role: 'ceo',
      scopes: [scope],
      permissions: ['director.submit', 'director.read'],
      expiresAt: Date.now() + 3600000,
    };
    policy = new Md2Policy(store, { scope, grants, reviewerIds: ['test-reviewer'] });
    director = makeDirector(store, scope);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // Test fixtures never perform external work; known zero settles any simulated reservation.
    for (const source of stores) {
      const snapshot = await source.read();
      if (!snapshot) continue;
      const l = new Md2Limits(source, {
        scope: { clientId: snapshot.clientId, projectId: snapshot.projectId },
        task: zero,
        agent: zero,
        project: zero,
      });
      for (const id of (await l.usage()).activeAttemptIds)
        await l.settle(id, { tokens: 0, costMicros: 0 });
      await l.synchronize();
    }
    stores.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function makeDirector(source: Md2Storage, target: StorageScope): Md2Director {
    return new Md2Director(source, {
      scope: target,
      policy: new Md2Policy(source, { scope: target, grants }),
      limits: { task: zero, agent: zero, project: zero },
      authenticate: async (context) => (context === session ? principal : null),
    });
  }
  function queue(
    options: {
      source?: Md2Storage;
      target?: StorageScope;
      director?: Md2Director;
      policy?: Md2Policy;
      limits?: LimitsConfiguration;
      maxAttempts?: number;
      leaseMs?: number;
      maxRunMs?: number;
      ownerId?: string;
    } = {},
  ) {
    const source = options.source ?? store;
    const target = options.target ?? scope;
    return new Md2Queue(source, {
      scope: target,
      director: options.director ?? director,
      policy: options.policy ?? policy,
      limits: options.limits ?? budgetConfig(target),
      allocation: { tokens: 10, costMicros: 10 },
      maxAttempts: options.maxAttempts,
      leaseMs: options.leaseMs,
      maxRunMs: options.maxRunMs,
      ownerId: options.ownerId,
    });
  }
  async function demand(
    priority: DemandPriority = 'normal',
    source = director,
    target: StorageScope = scope,
  ) {
    return (
      await source.receive(
        {
          requestId: `request-${++sequence}`,
          scope: target,
          title: 'Rascunho de código',
          description: 'Preparar uma proposta técnica para revisão.',
          intent: 'technology.code',
          urgency: priority,
        },
        session,
      )
    ).demand;
  }
  async function enqueued(q = queue(), priority: DemandPriority = 'normal') {
    const d = await demand(priority);
    return (await q.enqueue(d.id, session)).item;
  }
  async function otherProject() {
    const target = { ...scope, projectId: 'queue-other-project' };
    principal.scopes = [scope, target];
    const source = new Md2Storage({ root, scope: target });
    stores.add(source);
    await source.initialize();
    const d = makeDirector(source, target);
    const p = new Md2Policy(source, { scope: target, grants, reviewerIds: ['test-reviewer'] });
    return {
      source,
      target,
      director: d,
      queue: queue({ source, target, director: d, policy: p }),
    };
  }

  it('enqueues only a classified demand with a stable assigned work item and initial history', async () => {
    const q = queue();
    const item = await enqueued(q);
    expect(item).toMatchObject({
      scope,
      state: 'queued',
      agentId: 'andre',
      capability: 'code.draft',
      attempts: 0,
      lease: null,
      priority: 'normal',
    });
    expect(item.id).toMatch(/^work-[a-f0-9]{40}$/);
    expect(item.history).toHaveLength(1);
    expect(await q.get(item.id, session)).toEqual(item);
    const snapshot = (await store.read())!;
    expect(snapshot.data.tasks.find((task) => task.id === item.id)).toMatchObject({
      agentId: 'andre',
      status: 'created',
    });
    expect(snapshot.data.agents.every((agent) => agent.status === 'inactive')).toBe(true);
  });

  it('rejects ambiguous demands and unauthenticated/read-only submissions', async () => {
    const ambiguous = await director.receive(
      { requestId: 'ambiguous', scope, title: 'Ajuda', description: 'Preciso de orientação.' },
      session,
    );
    await expect(queue().enqueue(ambiguous.demand.id, session)).rejects.toMatchObject({
      code: 'DIRECTOR_DEMAND_NOT_ELIGIBLE',
    });
    const d = await demand();
    await expect(queue().enqueue(d.id, { ...session })).rejects.toThrow();
    principal.permissions = ['director.read'];
    await expect(queue().enqueue(d.id, session)).rejects.toMatchObject({
      code: 'DIRECTOR_NOT_AUTHORIZED',
    });
    expect((await store.read())?.data.tasks).toHaveLength(2);
  });

  it('deduplicates enqueue across instances and after restart without rewriting history', async () => {
    const d = await demand();
    const results = await Promise.all([
      queue().enqueue(d.id, session),
      queue().enqueue(d.id, session),
    ]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results[0].item.id).toBe(results[1].item.id);
    const bytes = fs.readFileSync(store.file);
    const restarted = new Md2Storage({ root, scope });
    const again = await queue({
      source: restarted,
      director: makeDirector(restarted, scope),
      policy: new Md2Policy(restarted, { scope, grants }),
    }).enqueue(d.id, session);
    expect(again.duplicate).toBe(true);
    expect(fs.readFileSync(store.file)).toEqual(bytes);
  });

  it('orders high, normal and low priority FIFO and never preempts a reserved item', async () => {
    const q = queue();
    const low = await enqueued(q, 'low');
    const normal1 = await enqueued(q);
    const normal2 = await enqueued(q);
    const high = await enqueued(q, 'high');
    const first = (await q.reserveNext())!;
    expect(first.id).toBe(high.id);
    const urgent = await enqueued(q, 'high');
    expect(await q.reserveNext()).toBeNull();
    expect((await q.get(high.id, session))?.state).toBe('reserved');
    await q.confirm(first.id, first.lease!.id, { tokens: 0, costMicros: 0 });
    for (const expected of [urgent.id, normal1.id, normal2.id, low.id]) {
      const next = (await q.reserveNext())!;
      expect(next.id).toBe(expected);
      await q.confirm(next.id, next.lease!.id, { tokens: 0, costMicros: 0 });
    }
  });

  it('reserves one task atomically across concurrent instances', async () => {
    await enqueued();
    await enqueued();
    const results = await Promise.all([
      queue().reserveNext(),
      queue().reserveNext(),
      queue().reserveNext(),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.find(Boolean)!;
    expect(winner).toMatchObject({ state: 'reserved', attempts: 1 });
    expect(winner.lease!.expiresAt).toBeGreaterThan(winner.lease!.issuedAt);
    expect((await new Md2Limits(store, budgetConfig()).usage()).activeAttemptIds).toEqual([
      winner.lease!.attemptId,
    ]);
  });

  it('shares global concurrency between projects', async () => {
    const first = queue();
    await enqueued(first);
    const other = await otherProject();
    const d = await demand('normal', other.director, other.target);
    await other.queue.enqueue(d.id, session);
    const results = await Promise.all([first.reserveNext(), other.queue.reserveNext()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('keeps a global slot across different roots even when their scope IDs match', async () => {
    const q = queue();
    const first = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    const otherRoot = path.join(root, 'another-data-root');
    fs.mkdirSync(otherRoot);
    const source = new Md2Storage({ root: otherRoot, scope });
    stores.add(source);
    await source.initialize();
    const d = makeDirector(source, scope);
    const p = new Md2Policy(source, { scope, grants });
    const other = queue({ source, director: d, policy: p });
    const nextDemand = await demand('normal', d);
    await other.enqueue(nextDemand.id, session);
    expect(await other.reserveNext()).toBeNull();
    await q.confirm(first.id, reserved.lease!.id, { tokens: 0, costMicros: 0 });
    expect((await other.reserveNext())?.state).toBe('reserved');
  });

  it('blocks revoked permissions without allocating an attempt', async () => {
    const q = queue();
    const item = await enqueued(q);
    const denied = queue({ policy: new Md2Policy(store, { scope, grants: [] }) });
    expect(await denied.reserveNext()).toBeNull();
    expect(await q.get(item.id, session)).toMatchObject({
      state: 'blocked',
      reason: 'POLICY_EXPLICIT_GRANT_REQUIRED',
      attempts: 0,
    });
    expect((await new Md2Limits(store, budgetConfig()).usage()).attempts).toBe(0);
    expect((await q.reserveNext())?.id).toBe(item.id);
  });

  it.each(['missing', 'expired', 'exhausted', 'limit'] as const)(
    'blocks unavailable budget (%s) and does not consume attempts',
    async (mode) => {
      const config = budgetConfig();
      if (mode === 'missing') delete config.budget;
      if (mode === 'expired') config.budget!.expiresAt = 0;
      if (mode === 'exhausted') config.budget!.maxTokens = 0;
      if (mode === 'limit') config.task.maxCostMicros = 1;
      const q = queue({ limits: config });
      const item = await enqueued(q);
      expect(await q.reserveNext()).toBeNull();
      expect(await q.get(item.id, session)).toMatchObject({
        state: 'blocked',
        attempts: 0,
        lease: null,
      });
      const before = fs.readFileSync(store.file);
      expect(await q.reserveNext()).toBeNull();
      expect(fs.readFileSync(store.file)).toEqual(before);
    },
  );

  it('consumes an exact-action approval in the same commit as budget and lease', async () => {
    const approvalGrants = grants.map((grant) => ({
      ...grant,
      requireApproval: grant.agentId === 'andre',
    }));
    const p = new Md2Policy(store, {
      scope,
      grants: approvalGrants,
      reviewerIds: ['test-reviewer'],
    });
    const q = queue({ policy: p });
    const item = await enqueued(q);
    expect(await q.reserveNext()).toBeNull();
    expect((await q.get(item.id, session))?.reason).toBe('APPROVAL_REQUIRED');
    const action = await q.actionForNextAttempt(item.id);
    const request = await p.requestApproval(action);
    await p.decide(request.requestId, action, 'approve', 'test-reviewer');
    await q.attachApproval(item.id, request.requestId);
    const revision = (await store.read())!.revision;
    const reserved = (await q.reserveNext())!;
    expect((await store.read())!.revision).toBe(revision + 1);
    expect(reserved.attempts).toBe(1);
    await expect(p.consume(request.requestId, action)).rejects.toThrow();
    await q.release(item.id, reserved.lease!.id, 'not-started');
    expect(await q.reserveNext()).toBeNull();
    await expect(q.attachApproval(item.id, request.requestId)).rejects.toThrow();
  });

  it('does not attach an approval for changed action parameters', async () => {
    const p = new Md2Policy(store, {
      scope,
      grants: grants.map((grant) => ({ ...grant, requireApproval: grant.agentId === 'andre' })),
      reviewerIds: ['test-reviewer'],
    });
    const q = queue({ policy: p });
    const item = await enqueued(q);
    const action = {
      ...(await q.actionForNextAttempt(item.id)),
      parameters: { description: 'Different action' },
    };
    const request = await p.requestApproval(action);
    await p.decide(request.requestId, action, 'approve', 'test-reviewer');
    await expect(q.attachApproval(item.id, request.requestId)).rejects.toThrow();
    expect((await q.get(item.id, session))?.attempts).toBe(0);
  });

  it('expires leases cooperatively and holds the global slot until explicit reconciliation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const q = queue({ leaseMs: 100 });
    const item = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    vi.setSystemTime(reserved.lease!.expiresAt);
    expect(await q.recover()).toMatchObject({ held: true, reconciliationRequired: [item.id] });
    expect((await q.get(item.id, session))?.state).toBe('reconciliation_required');
    expect(await q.reserveNext()).toBeNull();
    await expect(
      q.confirm(item.id, reserved.lease!.id, { tokens: 0, costMicros: 0 }),
    ).rejects.toThrow();
    const stillUnknown = await q.reconcile(item.id, reserved.lease!.id, 'unknown', {
      tokens: null,
      costMicros: null,
    });
    expect(stillUnknown.state).toBe('reconciliation_required');
    expect(await q.reserveNext()).toBeNull();
    const restored = await q.reconcile(item.id, reserved.lease!.id, 'not-started', {
      tokens: 0,
      costMicros: 0,
    });
    expect(restored).toMatchObject({ state: 'queued', attempts: 1, lease: null });
    expect((await q.reserveNext())?.attempts).toBe(2);
  });

  it('reconciles old owners on restart, never automatically returning their work to the queue', async () => {
    const old = queue({ ownerId: 'old-test-boot' });
    const item = await enqueued(old);
    const reserved = (await old.reserveNext())!;
    const restartedStore = new Md2Storage({ root, scope });
    const restarted = queue({
      source: restartedStore,
      ownerId: 'new-test-boot',
      director: makeDirector(restartedStore, scope),
      policy: new Md2Policy(restartedStore, { scope, grants }),
    });
    expect(await restarted.reserveNext()).toBeNull();
    expect(await restarted.get(item.id, session)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'OWNER_RESTARTED',
      attempts: 1,
    });
    const completed = await restarted.reconcile(item.id, reserved.lease!.id, 'completed', {
      tokens: 3,
      costMicros: 4,
    });
    expect(completed.state).toBe('completed');
    expect(await restarted.reserveNext()).toBeNull();
  });

  it('discovers a held lease in another project from the root inventory', async () => {
    const old = queue({ ownerId: 'boot-a' });
    const first = await enqueued(old);
    await old.reserveNext();
    const other = await otherProject();
    const d = await demand('normal', other.director, other.target);
    await other.queue.enqueue(d.id, session);
    expect(await other.queue.reserveNext()).toBeNull();
    expect((await other.queue.recover()).held).toBe(true);
    expect(await old.get(first.id, session)).toMatchObject({
      state: 'reconciliation_required',
      reason: 'OWNER_RESTARTED',
    });
  });

  it('preserves an approved action when budget is unavailable', async () => {
    const p = new Md2Policy(store, {
      scope,
      grants: grants.map((grant) => ({ ...grant, requireApproval: grant.agentId === 'andre' })),
      reviewerIds: ['test-reviewer'],
    });
    const deniedBudget = budgetConfig();
    delete deniedBudget.budget;
    const q = queue({ policy: p, limits: deniedBudget });
    const item = await enqueued(q);
    const action = await q.actionForNextAttempt(item.id);
    const approval = await p.requestApproval(action);
    await p.decide(approval.requestId, action, 'approve', 'test-reviewer');
    await q.attachApproval(item.id, approval.requestId);
    expect(await q.reserveNext()).toBeNull();
    const funded = queue({ policy: p });
    expect((await funded.reserveNext())?.id).toBe(item.id);
    await expect(p.consume(approval.requestId, action)).rejects.toThrow();
  });

  it('rolls back approval consumption with a failed atomic reservation', async () => {
    const p = new Md2Policy(store, {
      scope,
      grants: grants.map((grant) => ({ ...grant, requireApproval: grant.agentId === 'andre' })),
      reviewerIds: ['test-reviewer'],
    });
    const q = queue({ policy: p });
    const item = await enqueued(q);
    const action = await q.actionForNextAttempt(item.id);
    const approval = await p.requestApproval(action);
    await p.decide(approval.requestId, action, 'approve', 'test-reviewer');
    await q.attachApproval(item.id, approval.requestId);
    const before = fs.readFileSync(store.file);
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementationOnce(async () => {
      throw new Error('Simulated atomic failure');
    });
    await expect(q.reserveNext()).rejects.toThrow('Simulated atomic');
    expect(fs.readFileSync(store.file)).toEqual(before);
    vi.mocked(store.commit).mockImplementation(commit);
    expect((await q.reserveNext())?.id).toBe(item.id);
  });

  it('requires a fresh exact approval after expiration and explicit renewal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const p = new Md2Policy(store, {
      scope,
      grants: grants.map((grant) => ({ ...grant, requireApproval: grant.agentId === 'andre' })),
      reviewerIds: ['test-reviewer'],
    });
    const q = queue({ policy: p });
    const item = await enqueued(q);
    const oldAction = await q.actionForNextAttempt(item.id);
    const approval = await p.requestApproval(oldAction, 100);
    await p.decide(approval.requestId, oldAction, 'approve', 'test-reviewer');
    await q.attachApproval(item.id, approval.requestId);
    vi.setSystemTime(Date.now() + 100);
    expect(await q.reserveNext()).toBeNull();
    expect((await q.get(item.id, session))?.reason).toBe('APPROVAL_MISMATCH_EXPIRED_OR_USED');
    await q.renewApproval(item.id);
    const action = await q.actionForNextAttempt(item.id);
    expect(action.id).not.toBe(oldAction.id);
    const fresh = await p.requestApproval(action);
    await p.decide(fresh.requestId, action, 'approve', 'test-reviewer');
    await q.attachApproval(item.id, fresh.requestId);
    expect((await q.reserveNext())?.id).toBe(item.id);
  });

  it('detects orphan budget reservations and blocks new claims', async () => {
    const q = queue();
    const item = await enqueued(q);
    const l = new Md2Limits(store, budgetConfig());
    await l.reserve(item.id, item.agentId, item.allocation);
    const recovery = await q.recover();
    expect(recovery.held).toBe(true);
    expect(recovery.orphanAttemptIds).toHaveLength(1);
    expect(await q.reserveNext()).toBeNull();
  });

  it('cancels an unreserved item idempotently without a lease or budget allocation', async () => {
    const q = queue();
    const item = await enqueued(q);
    expect((await q.cancel(item.id)).state).toBe('cancelled');
    const bytes = fs.readFileSync(store.file);
    await q.cancel(item.id);
    expect(fs.readFileSync(store.file)).toEqual(bytes);
    expect(await q.reserveNext()).toBeNull();
    expect((await new Md2Limits(store, budgetConfig()).usage()).attempts).toBe(0);
  });

  it('does not release a reserved cancellation until its outcome is reconciled', async () => {
    const q = queue();
    const item = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    expect((await q.cancel(item.id)).state).toBe('reconciliation_required');
    expect(await q.reserveNext()).toBeNull();
    expect(
      (await q.reconcile(item.id, reserved.lease!.id, 'cancelled', { tokens: 0, costMicros: 0 }))
        .state,
    ).toBe('cancelled');
  });

  it('requires the exact active lease and a not-started attestation to release it', async () => {
    const q = queue();
    const item = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    await expect(q.release(item.id, 'wrong-lease', 'not-started')).rejects.toThrow();
    expect(() => q.release(item.id, reserved.lease!.id, 'unknown' as 'not-started')).toThrow();
    const released = await q.release(item.id, reserved.lease!.id, 'not-started');
    expect(released).toMatchObject({
      state: 'queued',
      attempts: 1,
      lastConsumption: { tokens: 0, costMicros: 0 },
    });
    expect((await q.reserveNext())?.lease!.id).not.toBe(reserved.lease!.id);
  });

  it('caps retries durably and never resets counts when the queue instance changes', async () => {
    const q = queue({ maxAttempts: 2 });
    const item = await enqueued(q);
    for (let n = 0; n < 2; n++) {
      const reserved = (await q.reserveNext())!;
      await q.release(item.id, reserved.lease!.id, 'not-started');
    }
    expect(await q.get(item.id, session)).toMatchObject({
      state: 'failed',
      reason: 'ATTEMPT_LIMIT_REACHED',
      attempts: 2,
    });
    expect(await queue({ maxAttempts: 10 }).reserveNext()).toBeNull();
    const d = (await q.get(item.id, session))!.demandId;
    expect((await queue({ maxAttempts: 10 }).enqueue(d, session)).item.state).toBe('failed');
  });

  it('records failure as terminal without automatic reprocessing', async () => {
    const q = queue();
    const item = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    expect((await q.fail(item.id, reserved.lease!.id, { tokens: 2, costMicros: 3 })).state).toBe(
      'failed',
    );
    expect(await q.reserveNext()).toBeNull();
    expect(await new Md2Limits(store, budgetConfig()).usage()).toMatchObject({
      knownTokens: 2,
      knownCostMicros: 3,
    });
  });

  it('keeps unknown consumption separate and blocks another task in the same project', async () => {
    const q = queue();
    const first = await enqueued(q);
    const second = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    await q.confirm(first.id, reserved.lease!.id, { tokens: null, costMicros: null });
    expect(await q.reserveNext()).toBeNull();
    expect(await q.get(second.id, session)).toMatchObject({
      state: 'blocked',
      reason: 'UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION',
    });
    expect(await new Md2Limits(store, budgetConfig()).usage()).toMatchObject({
      unknownCost: true,
      knownCostMicros: 0,
      heldCostMicros: 10,
    });
  });

  it('preserves project isolation for enqueue, query and configured budget', async () => {
    const q = queue();
    const item = await enqueued(q);
    const other = await otherProject();
    await expect(other.queue.enqueue(item.demandId, session)).rejects.toThrow();
    expect(await other.queue.get(item.id, session)).toBeNull();
    principal.scopes = [other.target];
    await expect(q.get(item.id, session)).rejects.toThrow();
    expect(() => queue({ limits: budgetConfig(other.target) })).toThrow();
  });

  it('rolls back budget and lease together when the reservation write fails', async () => {
    const q = queue();
    const item = await enqueued(q);
    const before = fs.readFileSync(store.file);
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementationOnce(async () => {
      throw new Error('Simulated claim failure');
    });
    await expect(q.reserveNext()).rejects.toThrow('Simulated claim');
    expect(fs.readFileSync(store.file)).toEqual(before);
    vi.mocked(store.commit).mockImplementation(commit);
    expect((await q.reserveNext())?.id).toBe(item.id);
  });

  it('holds a committed lease when its acknowledgement is lost', async () => {
    const q = queue();
    const item = await enqueued(q);
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementationOnce(async (changes, revision) => {
      await commit(changes, revision);
      throw new Error('Simulated lost claim acknowledgement');
    });
    await expect(q.reserveNext()).rejects.toThrow('Simulated lost claim');
    vi.mocked(store.commit).mockImplementation(commit);
    expect((await q.get(item.id, session))?.state).toBe('reserved');
    expect(await q.reserveNext()).toBeNull();
  });

  it('synchronizes a settled slot after a lost completion acknowledgement', async () => {
    const q = queue();
    const item = await enqueued(q);
    const reserved = (await q.reserveNext())!;
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementationOnce(async (changes, revision) => {
      await commit(changes, revision);
      throw new Error('Simulated lost completion acknowledgement');
    });
    await expect(
      q.confirm(item.id, reserved.lease!.id, { tokens: 1, costMicros: 1 }),
    ).rejects.toThrow('Simulated lost completion');
    vi.mocked(store.commit).mockImplementation(commit);
    expect((await q.confirm(item.id, reserved.lease!.id, { tokens: 1, costMicros: 1 })).state).toBe(
      'completed',
    );
    await enqueued(q);
    expect((await q.reserveNext())?.state).toBe('reserved');
  });

  it('does not register credentials or activate agents while distributing work', async () => {
    const redacted = await director.receive(
      {
        requestId: 'sensitive',
        scope,
        title: 'Código',
        description: 'password=example-value',
        intent: 'technology.code',
      },
      session,
    );
    await expect(queue().enqueue(redacted.demand.id, session)).rejects.toThrow();
    const q = queue();
    await enqueued(q);
    await q.reserveNext();
    expect(fs.readFileSync(store.file, 'utf8')).not.toContain('example-value');
    expect((await store.read())?.data.agents.every((agent) => agent.status === 'inactive')).toBe(
      true,
    );
  });

  it('blocks a valid intake whose encoded action exceeds the policy size limit', async () => {
    const d = await director.receive(
      {
        requestId: 'large-unicode-demand',
        scope,
        title: 'Rascunho de código',
        description: '漢'.repeat(6000),
        intent: 'technology.code',
      },
      session,
    );
    const q = queue();
    const item = (await q.enqueue(d.demand.id, session)).item;
    expect(await q.reserveNext()).toBeNull();
    expect(await q.get(item.id, session)).toMatchObject({
      state: 'blocked',
      reason: 'POLICY_ACTION_TOO_LARGE',
      attempts: 0,
    });
    expect((await new Md2Limits(store, budgetConfig()).usage()).attempts).toBe(0);
  });

  describe('03C-02 lease renewal and release idempotency', () => {
    function record(item: QueueItem): Record<string, unknown> {
      const { createdAt, updatedAt, history, releasedLease, ...rest } = item;
      void createdAt;
      void updatedAt;
      void history;
      void releasedLease;
      return rest;
    }
    async function forge(itemId: string, fields: Record<string, unknown>) {
      const snapshot = (await store.read())!;
      await store.commit(
        {
          events: [
            {
              id: 'queue-' + randomUUID(),
              taskId: itemId,
              type: 'status',
              message: JSON.stringify({ namespace: 'md2.queue.v1', ...fields }),
            },
          ],
        },
        snapshot.revision,
      );
    }

    it('renews only forward, persists each renewal and stops at the fixed deadline', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const q = queue({ leaseMs: 100, maxRunMs: 250 });
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const { id, attemptId, issuedAt, deadlineAt } = reserved.lease!;
      expect(deadlineAt).toBe(issuedAt + 250);
      vi.setSystemTime(issuedAt + 50);
      expect((await q.heartbeat(item.id, id, attemptId)).lease!.expiresAt).toBe(issuedAt + 150);
      vi.setSystemTime(issuedAt + 140);
      await q.heartbeat(item.id, id, attemptId);
      vi.setSystemTime(issuedAt + 230);
      const capped = await q.heartbeat(item.id, id, attemptId);
      expect(capped.lease).toEqual({ ...reserved.lease, expiresAt: deadlineAt });
      expect(capped.attempts).toBe(1);
      vi.setSystemTime(issuedAt + 240);
      await expect(q.heartbeat(item.id, id, attemptId)).rejects.toMatchObject({
        code: 'QUEUE_LEASE_DEADLINE_REACHED',
      });
      const restarted = new Md2Storage({ root, scope });
      const reloaded = await queue({
        source: restarted,
        director: makeDirector(restarted, scope),
        policy: new Md2Policy(restarted, { scope, grants }),
      }).get(item.id, session);
      expect(reloaded?.lease).toEqual(capped.lease);
      expect(reloaded?.history.map((entry) => entry.state)).toEqual([
        'queued',
        'reserved',
        'reserved',
        'reserved',
        'reserved',
      ]);
      // A more permissive instance cannot move the stored deadline.
      vi.setSystemTime(issuedAt + 245);
      await expect(
        queue({ leaseMs: 100, maxRunMs: 86400000 }).heartbeat(item.id, id, attemptId),
      ).rejects.toMatchObject({ code: 'QUEUE_LEASE_DEADLINE_REACHED' });
    });

    it('never renews an expired, reconciled, foreign or mismatched lease and writes nothing', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const q = queue({ leaseMs: 100, ownerId: 'owner-a' });
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const { id, attemptId } = reserved.lease!;
      const before = fs.readFileSync(store.file);
      for (const [leaseId, attempt] of [
        ['wrong-lease', attemptId],
        [id, 'wrong-attempt'],
      ])
        await expect(q.heartbeat(item.id, leaseId, attempt)).rejects.toMatchObject({
          code: 'QUEUE_LEASE_INVALID_OR_EXPIRED',
        });
      await expect(
        queue({ leaseMs: 100, ownerId: 'owner-b' }).heartbeat(item.id, id, attemptId),
      ).rejects.toMatchObject({ code: 'QUEUE_LEASE_INVALID_OR_EXPIRED' });
      vi.setSystemTime(reserved.lease!.expiresAt);
      await expect(q.heartbeat(item.id, id, attemptId)).rejects.toMatchObject({
        code: 'QUEUE_LEASE_INVALID_OR_EXPIRED',
      });
      expect(fs.readFileSync(store.file)).toEqual(before);
      await q.recover();
      expect((await q.get(item.id, session))?.state).toBe('reconciliation_required');
      vi.setSystemTime(reserved.lease!.issuedAt + 10);
      await expect(q.heartbeat(item.id, id, attemptId)).rejects.toMatchObject({
        code: 'QUEUE_LEASE_INVALID_OR_EXPIRED',
      });
    });

    it('serializes concurrent renewals and never renews after settlement', async () => {
      const q = queue({ ownerId: 'owner-a' });
      const peer = queue({ ownerId: 'owner-a' });
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const { id, attemptId } = reserved.lease!;
      const renewed = await Promise.all(
        [q, peer, q, peer, q].map((instance) => instance.heartbeat(item.id, id, attemptId)),
      );
      const current = (await q.get(item.id, session))!;
      expect(current.state).toBe('reserved');
      expect(current.attempts).toBe(1);
      expect(Math.max(...renewed.map((r) => r.lease!.expiresAt))).toBe(current.lease!.expiresAt);
      const outcomes = await Promise.allSettled([
        q.confirm(item.id, id, { tokens: 1, costMicros: 1 }),
        peer.heartbeat(item.id, id, attemptId),
      ]);
      expect(outcomes[0].status).toBe('fulfilled');
      expect((await q.get(item.id, session))?.state).toBe('completed');
      await expect(q.heartbeat(item.id, id, attemptId)).rejects.toMatchObject({
        code: 'QUEUE_LEASE_INVALID_OR_EXPIRED',
      });
    });

    it('rejects forged renewals past the deadline or changing other fields', async () => {
      const q = queue();
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const lease = reserved.lease!;
      await forge(item.id, {
        ...record(reserved),
        lease: { ...lease, expiresAt: lease.deadlineAt! + 1 },
      });
      await expect(q.get(item.id, session)).rejects.toMatchObject({ code: 'QUEUE_INVALID_LEDGER' });
    });

    it('rejects a forged renewal that also alters the attempt count', async () => {
      const q = queue();
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      await forge(item.id, {
        ...record(reserved),
        attempts: 2,
        lease: { ...reserved.lease!, expiresAt: reserved.lease!.expiresAt + 1 },
      });
      await expect(q.get(item.id, session)).rejects.toMatchObject({ code: 'QUEUE_INVALID_LEDGER' });
    });

    it('accepts legacy leases without a deadline and never renews them', async () => {
      const q = queue({ ownerId: 'legacy-owner' });
      const item = await enqueued(q);
      const now = Date.now();
      await forge(item.id, {
        ...record(item),
        state: 'reserved',
        attempts: 1,
        lease: {
          id: 'legacy-lease',
          attemptId: 'legacy-attempt',
          ownerId: 'legacy-owner',
          issuedAt: now,
          expiresAt: now + 3600000,
        },
      });
      const legacy = (await q.get(item.id, session))!;
      expect(legacy.state).toBe('reserved');
      expect(legacy.lease?.deadlineAt).toBeUndefined();
      await expect(q.heartbeat(item.id, 'legacy-lease', 'legacy-attempt')).rejects.toMatchObject({
        code: 'QUEUE_LEASE_DEADLINE_REACHED',
      });
    });

    it('builds the worker input from the exact reserved action', async () => {
      const q = queue();
      const item = await enqueued(q);
      await expect(q.actionForReservation(item.id)).rejects.toMatchObject({
        code: 'QUEUE_NOT_RESERVED',
      });
      const reserved = (await q.reserveNext())!;
      const input = workerInputFromReservation(reserved, await q.actionForReservation(item.id));
      expect(input).toMatchObject({
        workId: item.id,
        leaseId: reserved.lease!.id,
        attemptId: reserved.lease!.attemptId,
        agentId: 'andre',
        kind: 'internal.draft',
        deadlineAt: reserved.lease!.deadlineAt,
        content: { title: 'Rascunho de código' },
      });
      expect(input.authorization.actionId).not.toBe((await q.actionForNextAttempt(item.id)).id);
      expect(() => workerInputFromReservation(item, {} as PolicyAction)).toThrow();
    });

    it('acknowledges a repeated release after a lost acknowledgement without a new event', async () => {
      const q = queue();
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const commit = store.commit.bind(store);
      vi.spyOn(store, 'commit').mockImplementationOnce(async (changes, revision) => {
        await commit(changes, revision);
        throw new Error('Simulated lost release acknowledgement');
      });
      await expect(q.release(item.id, reserved.lease!.id, 'not-started')).rejects.toThrow(
        'Simulated lost release',
      );
      vi.mocked(store.commit).mockImplementation(commit);
      const bytes = fs.readFileSync(store.file);
      const again = await q.release(item.id, reserved.lease!.id, 'not-started');
      expect(again).toMatchObject({ state: 'queued', attempts: 1, lease: null });
      expect(again.releasedLease?.id).toBe(reserved.lease!.id);
      expect(fs.readFileSync(store.file)).toEqual(bytes);
      await expect(q.release(item.id, 'other-lease', 'not-started')).rejects.toThrow();
      await expect(
        queue({ ownerId: 'someone-else' }).release(item.id, reserved.lease!.id, 'not-started'),
      ).rejects.toMatchObject({ code: 'QUEUE_SETTLEMENT_CONFLICT' });
      await expect(
        q.confirm(item.id, reserved.lease!.id, { tokens: 0, costMicros: 0 }),
      ).rejects.toThrow();
      // The global slot was synchronized: the next attempt can be reserved.
      const next = (await q.reserveNext())!;
      expect(next.attempts).toBe(2);
      await expect(q.release(item.id, reserved.lease!.id, 'not-started')).rejects.toThrow();
    });

    it('acknowledges a repeated release that reached the attempt cap', async () => {
      const q = queue({ maxAttempts: 1 });
      const item = await enqueued(q);
      const reserved = (await q.reserveNext())!;
      const first = await q.release(item.id, reserved.lease!.id, 'not-started');
      expect(first).toMatchObject({ state: 'failed', reason: 'ATTEMPT_LIMIT_REACHED' });
      const bytes = fs.readFileSync(store.file);
      expect(await q.release(item.id, reserved.lease!.id, 'not-started')).toEqual(first);
      expect(fs.readFileSync(store.file)).toEqual(bytes);
      await expect(
        q.fail(item.id, reserved.lease!.id, { tokens: 0, costMicros: 0 }),
      ).rejects.toMatchObject({ code: 'QUEUE_SETTLEMENT_CONFLICT' });
    });
  });
});
