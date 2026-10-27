import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AuthenticatedDirectorPrincipal, Md2Director } from '../src/md2/director.js';
import { Md2Executor, type Md2Worker } from '../src/md2/executor.js';
import { type LimitsConfiguration, Md2Limits } from '../src/md2/limits.js';
import {
  hashOperatorSecret,
  Md2OperatorAuth,
  type OperatorConfig,
  type OperatorCredential,
} from '../src/md2/operatorAuth.js';
import { Md2Policy, type PolicyGrant } from '../src/md2/policy.js';
import { Md2Queue } from '../src/md2/queue.js';
import { Md2Storage, type StorageScope } from '../src/md2/storage.js';
import type { WorkerInput } from '../src/md2/worker.js';

const scope = { clientId: 'exec-client', projectId: 'exec-project' };
const other = { clientId: 'exec-client', projectId: 'exec-other' };
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
const SECRET = 'executor-operator-secret';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function budget(target: StorageScope): LimitsConfiguration {
  return {
    scope: { ...target },
    task: { maxAttempts: 10, maxTokens: 1000, maxCostMicros: 1000 },
    agent: { maxAttempts: 100, maxTokens: 10000, maxCostMicros: 10000 },
    project: { maxAttempts: 100, maxTokens: 10000, maxCostMicros: 10000 },
    budget: {
      id: 'exec-budget',
      scope: { ...target },
      currency: 'USD',
      maxTokens: 10000,
      maxCostMicros: 10000,
      expiresAt: Date.now() + 3600000,
    },
  };
}
function reply(input: WorkerInput, overrides: Record<string, unknown> = {}) {
  return {
    workId: input.workId,
    leaseId: input.leaseId,
    attemptId: input.attemptId,
    outcome: 'completed',
    reason: 'COMPLETED',
    consumption: { tokens: 3, costMicros: 4 },
    output: 'Rascunho pronto.',
    ...overrides,
  };
}
function untilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}
/** Simulated worker: no process, network, model or file access. */
function simulated(run: (input: WorkerInput, signal: AbortSignal) => Promise<unknown>) {
  const calls: WorkerInput[] = [];
  const worker: Md2Worker = {
    run: (input, signal) => {
      calls.push(input);
      return run(input, signal);
    },
  };
  return { worker, calls };
}

describe('MD2 executor with a simulated worker', () => {
  let credential: OperatorCredential;
  let root: string;
  let store: Md2Storage;
  let director: Md2Director;
  let policy: Md2Policy;
  let auth: Md2OperatorAuth;
  let operator: string;
  let reader: string;
  let outsider: string;
  let sequence: number;
  const session = Object.freeze({ fixture: 'executor-director-session' });
  const principal: AuthenticatedDirectorPrincipal = {
    subjectId: 'exec-ceo',
    role: 'ceo',
    scopes: [scope, other],
    permissions: ['director.submit', 'director.read'],
    expiresAt: Date.now() + 3600000,
  };
  const stores = new Set<Md2Storage>();

  beforeAll(async () => {
    credential = await hashOperatorSecret(SECRET, 16384);
  });
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-exec-'));
    store = new Md2Storage({ root, scope });
    stores.add(store);
    await store.initialize();
    policy = new Md2Policy(store, { scope, grants });
    director = makeDirector(store, scope);
    sequence = 0;
    const entry = (
      subjectId: string,
      roles: string[],
      permissions: string[],
      scopes: object[],
    ) => ({
      subjectId,
      roles,
      permissions,
      scopes,
      credential,
    });
    auth = new Md2OperatorAuth({
      version: 1,
      operators: [
        entry('exec-operator', ['operator'], ['queue.read', 'queue.operate'], [scope]),
        entry('exec-reader', ['operator'], ['queue.read'], [scope]),
        entry('exec-outsider', ['operator'], ['queue.read', 'queue.operate'], [other]),
      ],
    } as unknown as OperatorConfig);
    operator = (await auth.login('exec-operator', SECRET)).token;
    reader = (await auth.login('exec-reader', SECRET)).token;
    outsider = (await auth.login('exec-outsider', SECRET)).token;
  });
  afterEach(async () => {
    // Simulated runs never consume anything: settle any held reservation so the global slot frees.
    for (const source of stores) {
      const snapshot = await source.read().catch(() => null);
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

  function makeDirector(source: Md2Storage, target: StorageScope) {
    return new Md2Director(source, {
      scope: target,
      policy: new Md2Policy(source, { scope: target, grants }),
      limits: { task: zero, agent: zero, project: zero },
      authenticate: async (context) => (context === session ? principal : null),
    });
  }
  function queue(
    options: { source?: Md2Storage; ownerId?: string; maxRunMs?: number; leaseMs?: number } = {},
  ) {
    const source = options.source ?? store;
    return new Md2Queue(source, {
      scope,
      director: source === store ? director : makeDirector(source, scope),
      policy: source === store ? policy : new Md2Policy(source, { scope, grants }),
      limits: budget(scope),
      allocation: { tokens: 10, costMicros: 10 },
      // Generous for slow disks under parallel load; production uses 60 s.
      leaseMs: options.leaseMs ?? 1500,
      maxRunMs: options.maxRunMs ?? 4000,
      ownerId: options.ownerId,
    });
  }
  function executor(worker: Md2Worker, q = queue(), source = store, settleMarginMs = 200) {
    return new Md2Executor(source, {
      scope,
      queue: q,
      auth,
      worker,
      settleMarginMs,
      abortGraceMs: 150,
    });
  }
  async function enqueue(q = queue()) {
    const { demand } = await director.receive(
      {
        requestId: `exec-request-${++sequence}`,
        scope,
        title: 'Rascunho de código',
        description: 'Preparar uma proposta técnica para revisão.',
        intent: 'technology.code',
      },
      session,
    );
    return (await q.enqueue(demand.id, session)).item;
  }
  async function journal(workId: string) {
    const snapshot = (await store.read())!;
    return snapshot.data.events
      .filter((event) => event.id.startsWith('executor-') && event.taskId === workId)
      .map((event) => JSON.parse(event.message) as Record<string, unknown>);
  }

  it('refuses to run without an operator session holding queue.operate on this scope', async () => {
    const { worker, calls } = simulated(async (input) => reply(input));
    const q = queue();
    const item = await enqueue(q);
    const e = executor(worker, q);
    for (const [token, code] of [
      [undefined, 'OPERATOR_SESSION_INVALID'],
      ['A'.repeat(43), 'OPERATOR_SESSION_INVALID'],
      [reader, 'OPERATOR_PERMISSION_DENIED'],
      [outsider, 'OPERATOR_SCOPE_DENIED'],
    ])
      await expect(e.runNext(token)).rejects.toMatchObject({ code });
    expect(calls).toHaveLength(0);
    expect((await q.peek(item.id))?.state).toBe('queued');
    await expect(e.recover(reader)).rejects.toMatchObject({ code: 'OPERATOR_PERMISSION_DENIED' });
    await expect(e.cancel(reader, item.id)).rejects.toMatchObject({
      code: 'OPERATOR_PERMISSION_DENIED',
    });
  });

  it('persists the start marker before the worker runs, then completes and journals the result', async () => {
    const q = queue();
    const item = await enqueue(q);
    let markerSeen = false;
    const { worker, calls } = simulated(async (input) => {
      markerSeen = (await journal(input.workId)).some(
        (entry) => entry.phase === 'started' && entry.attemptId === input.attemptId,
      );
      return reply(input);
    });
    const report = await executor(worker, q).runNext(operator);
    expect(markerSeen).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ workId: item.id, kind: 'internal.draft', agentId: 'andre' });
    expect(report).toMatchObject({ state: 'completed', outcome: 'completed', settled: true });
    const entries = await journal(item.id);
    expect(entries.map((entry) => entry.phase)).toEqual(['started', 'result']);
    expect(entries[0].operatorId).toBe('exec-operator');
    expect(entries[1]).toMatchObject({ output: 'Rascunho pronto.', truncated: false });
    expect(await new Md2Limits(store, budget(scope)).usage()).toMatchObject({
      knownTokens: 3,
      knownCostMicros: 4,
    });
    expect((await store.read())?.data.agents.every((agent) => agent.status === 'inactive')).toBe(
      true,
    );
  });

  it('keeps the lease alive with heartbeats beyond the lease duration', async () => {
    // 2.5x the lease: only renewals can keep it alive, with room for slow disks under load.
    const q = queue({ leaseMs: 2000, maxRunMs: 15000 });
    const item = await enqueue(q);
    const { worker } = simulated(async (input) => {
      await sleep(5000);
      return reply(input);
    });
    expect((await executor(worker, q).runNext(operator))?.state).toBe('completed');
    const history = (await q.peek(item.id))!.history.map((entry) => entry.state);
    expect(history.filter((state) => state === 'reserved').length).toBeGreaterThan(3);
  }, 30000);

  it('records a reported failure as terminal and never retries it automatically', async () => {
    const q = queue();
    await enqueue(q);
    const { worker, calls } = simulated(async (input) =>
      reply(input, {
        outcome: 'failed',
        reason: 'AGENT_FAILED',
        consumption: { tokens: 1, costMicros: 1 },
      }),
    );
    const e = executor(worker, q);
    expect(await e.runNext(operator)).toMatchObject({ state: 'failed', settled: true });
    expect(await e.runNext(operator)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('treats a thrown or invalid worker report as uncertain and holds the slot', async () => {
    for (const run of [
      async () => {
        throw new Error('simulated crash inside the worker');
      },
      async (input: WorkerInput) => reply(input, { attemptId: 'someone-else' }),
    ]) {
      const q = queue();
      const item = await enqueue(q);
      const { worker, calls } = simulated(run);
      const e = executor(worker, q);
      expect(await e.runNext(operator)).toMatchObject({
        state: 'reconciliation_required',
        settled: false,
      });
      expect((await q.peek(item.id))?.reason).toBe('WORKER_NO_RESULT');
      await enqueue(q);
      expect(await e.runNext(operator)).toBeNull();
      expect(calls).toHaveLength(1);
      const recovered = await e.recover(operator);
      expect(recovered.uncertain.map((entry) => entry.workId)).toContain(item.id);
      expect(recovered.notStarted).toEqual([]);
      const lease = (await q.peek(item.id))!.lease!;
      await expect(
        e.reconcile(reader, item.id, lease.id, 'failed', { tokens: 0, costMicros: 0 }),
      ).rejects.toMatchObject({ code: 'OPERATOR_PERMISSION_DENIED' });
      expect(
        (await e.reconcile(operator, item.id, lease.id, 'failed', { tokens: 0, costMicros: 0 }))
          .state,
      ).toBe('failed');
      const { worker: next } = simulated(async (input) => reply(input));
      expect((await executor(next, q).runNext(operator))?.state).toBe('completed');
    }
  });

  it('cancels a running task cooperatively and records the reported consumption', async () => {
    const q = queue();
    const item = await enqueue(q);
    const { worker } = simulated(async (input, signal) => {
      await untilAbort(signal);
      return reply(input, {
        outcome: 'cancelled',
        reason: 'CANCELLED_BY_OPERATOR',
        consumption: { tokens: 1, costMicros: 2 },
        output: '',
      });
    });
    const e = executor(worker, q);
    const running = e.runNext(operator);
    await sleep(120);
    await expect(e.cancel(reader, item.id)).rejects.toMatchObject({
      code: 'OPERATOR_PERMISSION_DENIED',
    });
    expect(await e.cancel(operator, item.id)).toBe('stopping');
    expect(await running).toMatchObject({
      state: 'cancelled',
      stopReason: 'CANCELLED_BY_OPERATOR',
      settled: true,
    });
    expect(await new Md2Limits(store, budget(scope)).usage()).toMatchObject({
      knownTokens: 1,
      knownCostMicros: 2,
    });
  });

  it('holds an ignored cancellation for reconciliation after the grace period', async () => {
    const q = queue();
    const item = await enqueue(q);
    const { worker } = simulated(() => new Promise(() => {}));
    const e = executor(worker, q);
    const running = e.runNext(operator);
    await sleep(120);
    await e.cancel(operator, item.id);
    expect(await running).toMatchObject({
      state: 'reconciliation_required',
      stopReason: 'CANCELLED_BY_OPERATOR',
      settled: false,
    });
  });

  it('stops at the deadline: a reported timeout fails, a silent worker becomes uncertain', async () => {
    // A longer lease and settle margin keep this test about the deadline, not machine load.
    const q = queue({ maxRunMs: 2000, leaseMs: 1000 });
    await enqueue(q);
    const { worker } = simulated(async (input, signal) => {
      await untilAbort(signal);
      return reply(input, {
        outcome: 'failed',
        reason: 'TIMEOUT',
        consumption: { tokens: 2, costMicros: 2 },
        output: '',
      });
    });
    expect(await executor(worker, q, store, 800).runNext(operator)).toMatchObject({
      state: 'failed',
      stopReason: 'TIMEOUT',
    });
    const silentQueue = queue({ maxRunMs: 2000, leaseMs: 1000 });
    const silent = await enqueue(silentQueue);
    const { worker: stuck } = simulated(() => new Promise(() => {}));
    expect(await executor(stuck, silentQueue, store, 800).runNext(operator)).toMatchObject({
      state: 'reconciliation_required',
      stopReason: 'TIMEOUT',
      settled: false,
    });
    expect((await silentQueue.peek(silent.id))?.reason).toBe('TIMEOUT');
  });

  it('stops the worker when the lease is lost and never settles the item itself', async () => {
    const q = queue();
    const item = await enqueue(q);
    let aborted = false;
    const { worker } = simulated(async (input, signal) => {
      await untilAbort(signal);
      aborted = true;
      return reply(input);
    });
    const running = executor(worker, q).runNext(operator);
    await sleep(120);
    // Another authorized party takes the item away: the lease is no longer renewable.
    await queue().cancel(item.id);
    const report = await running;
    expect(aborted).toBe(true);
    expect(report).toMatchObject({
      stopReason: 'LEASE_LOST',
      outcome: 'completed',
      state: 'reconciliation_required',
      settled: false,
    });
    expect((await journal(item.id)).map((entry) => entry.phase)).toEqual(['started', 'uncertain']);
  });

  it('after a restart, re-queues only attempts without a start marker', async () => {
    // Crash before the marker: the old owner reserved but never started.
    const old = queue({ ownerId: 'old-boot' });
    const notStarted = await enqueue(old);
    expect((await old.reserveNext())?.id).toBe(notStarted.id);
    const restartedStore = new Md2Storage({ root, scope });
    const restarted = queue({ source: restartedStore, ownerId: 'new-boot' });
    const { worker, calls } = simulated(async (input) => reply(input));
    const e = executor(worker, restarted, restartedStore);
    const report = await e.recover(operator);
    expect(report).toMatchObject({ notStarted: [notStarted.id], uncertain: [] });
    expect(await e.runNext(operator)).toMatchObject({ workId: notStarted.id, state: 'completed' });
    expect(calls).toHaveLength(1);
    expect((await restarted.peek(notStarted.id))?.attempts).toBe(2);
  });

  it('after a restart, holds an attempt that had started for operator reconciliation', async () => {
    const old = queue({ ownerId: 'old-boot' });
    const item = await enqueue(old);
    const { worker: hung } = simulated(() => new Promise(() => {}));
    const crashed = executor(hung, old).runNext(operator);
    await sleep(120);
    const restartedStore = new Md2Storage({ root, scope });
    const restarted = queue({ source: restartedStore, ownerId: 'new-boot' });
    const { worker, calls } = simulated(async (input) => reply(input));
    const e = executor(worker, restarted, restartedStore);
    const report = await e.recover(operator);
    expect(report.notStarted).toEqual([]);
    expect(report.uncertain).toMatchObject([{ workId: item.id, reported: null }]);
    expect(await e.runNext(operator)).toBeNull();
    expect(calls).toHaveLength(0);
    // The old run notices its lost lease and stops without settling.
    expect(await crashed).toMatchObject({ stopReason: 'LEASE_LOST', settled: false });
    const lease = (await restarted.peek(item.id))!.lease!;
    await e.reconcile(operator, item.id, lease.id, 'completed', { tokens: 5, costMicros: 5 });
    expect((await restarted.peek(item.id))?.state).toBe('completed');
  });

  it('keeps unknown consumption as null and blocks the project until it is reconciled', async () => {
    const q = queue();
    const first = await enqueue(q);
    const { worker } = simulated(async (input) =>
      reply(input, { consumption: { tokens: null, costMicros: null } }),
    );
    const e = executor(worker, q);
    expect((await e.runNext(operator))?.state).toBe('completed');
    expect((await q.peek(first.id))?.lastConsumption).toEqual({ tokens: null, costMicros: null });
    const second = await enqueue(q);
    expect(await e.runNext(operator)).toBeNull();
    expect((await q.peek(second.id))?.reason).toBe('UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION');
    const limits = new Md2Limits(store, budget(scope));
    await limits.reconcile((await q.peek(first.id))!.lease!.attemptId, {
      tokens: 7,
      costMicros: 8,
    });
    expect((await e.runNext(operator))?.workId).toBe(second.id);
  });

  it('runs at most one task globally and refuses overlapping runs on one executor', async () => {
    const q = queue();
    await enqueue(q);
    await enqueue(q);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { worker, calls } = simulated(async (input) => {
      await gate;
      return reply(input);
    });
    const e = executor(worker, q);
    const first = e.runNext(operator);
    await expect(e.runNext(operator)).rejects.toMatchObject({ code: 'EXECUTOR_BUSY' });
    await sleep(80);
    expect(await executor(worker, queue()).runNext(operator)).toBeNull();
    release();
    expect((await first)?.state).toBe('completed');
    expect(calls).toHaveLength(1);
  });

  it('isolates projects: a store for another scope is refused', async () => {
    const otherStore = new Md2Storage({ root, scope: other });
    stores.add(otherStore);
    await otherStore.initialize();
    const { worker } = simulated(async (input) => reply(input));
    await expect(executor(worker, queue(), otherStore).runNext(operator)).rejects.toMatchObject({
      code: 'EXECUTOR_SCOPE_MISMATCH',
    });
  });

  it('returns a worker-attested not-started attempt to the queue', async () => {
    const q = queue();
    const item = await enqueue(q);
    let first = true;
    const { worker } = simulated(async (input) => {
      if (!first) return reply(input);
      first = false;
      return reply(input, {
        outcome: 'not-started',
        reason: 'NOT_STARTED',
        consumption: { tokens: 0, costMicros: 0 },
        output: '',
      });
    });
    const e = executor(worker, q);
    expect(await e.runNext(operator)).toMatchObject({ state: 'queued', settled: true });
    expect(await e.runNext(operator)).toMatchObject({ workId: item.id, state: 'completed' });
    expect((await q.peek(item.id))?.attempts).toBe(2);
  });
});
