import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MD2_AGENT_REGISTRY } from '../../core/src/md2AgentRegistry.js';
import {
  type AuthenticatedDirectorPrincipal,
  type DirectorDemandInput,
  Md2Director,
} from '../src/md2/director.js';
import { Md2Limits } from '../src/md2/limits.js';
import { Md2Policy, type PolicyGrant } from '../src/md2/policy.js';
import { type SecurityStore } from '../src/md2/securityLedger.js';
import { Md2Storage, type StorageScope } from '../src/md2/storage.js';
import { seal } from '../src/md2/storageSchema.js';

const scope = { clientId: 'test-client', projectId: 'test-project' };
const zero = { maxAttempts: 0, maxTokens: 0, maxCostMicros: 0 };
// Unit-test grants and sessions only; no production account, token or CEO identity is created.
const fixtureGrants: PolicyGrant[] = MD2_AGENT_REGISTRY.flatMap((agent) =>
  agent.capabilities.flatMap((capability) =>
    (['internal.analyze', 'internal.draft'] as const).map((kind) => ({
      agentId: agent.id,
      capability,
      kind,
      requireApproval: false,
    })),
  ),
);
const routes = [
  ['strategy.plan', 'carlos', 'general-management', 'strategy.plan'],
  ['commercial.prospect', 'lucas', 'commercial', 'leads.analyze'],
  ['commercial.qualify', 'fernanda', 'commercial', 'leads.analyze'],
  ['commercial.proposal', 'rafael', 'commercial', 'proposals.draft'],
  ['marketing.strategy', 'mariana', 'marketing', 'campaigns.plan'],
  ['marketing.brand', 'beatriz', 'marketing', 'campaigns.plan'],
  ['marketing.performance', 'gabriel', 'marketing', 'marketing.analyze'],
  ['marketing.media', 'pedro', 'marketing', 'campaigns.plan'],
  ['technology.code', 'andre', 'technology', 'code.draft'],
  ['technology.architecture', 'camila', 'technology', 'software.design'],
  ['technology.automation', 'diego', 'technology', 'software.design'],
  ['technology.quality', 'sofia', 'technology', 'tests.plan'],
  ['support.triage', 'juliana', 'support', 'support.triage'],
  ['support.relationship', 'bruno', 'support', 'replies.draft'],
  ['finance.analysis', 'renata', 'finance', 'finance.analyze'],
  ['finance.report', 'eduardo', 'finance', 'finance.reports.draft'],
  ['operations.plan', 'thiago', 'operations', 'projects.plan'],
  ['operations.review', 'amanda', 'operations', 'deliveries.review'],
  ['production.draft', 'isabela', 'production', 'content.draft'],
  ['production.review', 'vinicius', 'production', 'content.review'],
  ['legal.review', 'helena', 'legal', 'legal.review'],
  ['administration.organize', 'patricia', 'administration', 'records.organize'],
] as const;

describe('Carlos deterministic demand intake', () => {
  let root: string;
  let store: Md2Storage;
  let session: object;
  let sessions: WeakMap<object, AuthenticatedDirectorPrincipal>;
  let principal: AuthenticatedDirectorPrincipal;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-director-'));
    store = new Md2Storage({ root, scope });
    await store.initialize();
    session = Object.freeze({ fixture: 'unit-test-only' });
    principal = {
      subjectId: 'test-ceo-fixture',
      role: 'ceo',
      scopes: [{ ...scope }],
      permissions: ['director.submit', 'director.read'],
      expiresAt: Date.now() + 60000,
    };
    sessions = new WeakMap([[session, principal]]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function input(): DirectorDemandInput {
    return {
      requestId: 'request-1',
      scope: { ...scope },
      title: 'Preparar código',
      description: 'Elaborar um rascunho para revisão.',
      intent: 'technology.code',
    };
  }
  function policy(grants = fixtureGrants, source = store, targetScope = scope) {
    return new Md2Policy(source, { scope: targetScope, grants });
  }
  function director(
    p = policy(),
    source: SecurityStore = store,
    targetScope: StorageScope = scope,
  ) {
    return new Md2Director(source, {
      scope: targetScope,
      policy: p,
      limits: { task: zero, agent: zero, project: zero },
      authenticate: async (context) =>
        context && typeof context === 'object' ? (sessions.get(context) ?? null) : null,
    });
  }

  it('records valid intake atomically with initial history, priority and a responsible agent', async () => {
    const d = director();
    const result = await d.receive({ ...input(), urgency: 'high' }, session);
    expect(result.duplicate).toBe(false);
    expect(result.demand).toMatchObject({
      scope,
      submittedBy: principal.subjectId,
      status: 'classified',
      priority: 'high',
      ownerId: 'carlos',
      responsibleAgentId: 'andre',
      executionAllowed: false,
      classification: {
        departmentId: 'technology',
        capability: 'code.draft',
        proposedAgentId: 'andre',
      },
    });
    expect(result.demand.id).toMatch(/^demand-[a-f0-9]{48}$/);
    expect(result.demand.history.map((event) => event.status)).toEqual(['received', 'classified']);
    expect(result.demand.createdAt <= result.demand.updatedAt).toBe(true);
    expect(await d.get(result.demand.id, session)).toEqual(result.demand);
    const snapshot = (await store.read())!;
    expect(snapshot.data.tasks).toHaveLength(1);
    expect(snapshot.data.tasks[0]).toMatchObject({ agentId: 'carlos', status: 'created' });
    expect(snapshot.data.agents.every((agent) => agent.status === 'inactive')).toBe(true);
    expect(snapshot.data.events).toHaveLength(2);
    expect(snapshot.data.approvals).toHaveLength(0);
  });

  it.each(routes)(
    'maps %s to %s through the registered department/capability',
    async (intent, agentId, departmentId, capability) => {
      const result = await director().receive({ ...input(), intent }, session);
      expect(result.demand).toMatchObject({
        status: 'classified',
        responsibleAgentId: agentId,
        classification: { intent, departmentId, capability },
      });
      expect(MD2_AGENT_REGISTRY.find((agent) => agent.id === agentId)?.capabilities).toContain(
        capability,
      );
    },
  );

  it('uses accent-insensitive keyword rules and deterministic priority without an explicit intent', async () => {
    const body = input();
    delete body.intent;
    const result = await director().receive(
      { ...body, title: 'Código urgente', description: 'Preparar uma função.', urgency: 'low' },
      session,
    );
    expect(result.demand).toMatchObject({
      responsibleAgentId: 'andre',
      priority: 'high',
      reason: 'DETERMINISTIC_KEYWORD_MATCH',
    });
  });

  it.each(['Preciso de site e campanha', 'Preciso de ajuda com uma ideia'])(
    'keeps ambiguous or unclassified requests with Carlos (%s)',
    async (title) => {
      const body = input();
      delete body.intent;
      const result = await director().receive({ ...body, title }, session);
      expect(result.demand).toMatchObject({
        status: 'needs_clarification',
        responsibleAgentId: 'carlos',
        classification: null,
        executionAllowed: false,
      });
      expect((await store.read())?.data.tasks[0].status).toBe('created');
    },
  );

  it('requires a context recognized by the trusted authenticator, not a self-declared identity', async () => {
    const before = fs.readFileSync(store.file);
    for (const context of [
      null,
      { ...session },
      { subjectId: principal.subjectId, role: 'ceo', authenticated: true },
    ])
      await expect(director().receive(input(), context)).rejects.toMatchObject({
        code: 'DIRECTOR_NOT_AUTHORIZED',
      });
    await expect(
      director().receive({ ...input(), subjectId: principal.subjectId, role: 'ceo' }, session),
    ).rejects.toMatchObject({ code: 'DIRECTOR_INVALID_INPUT' });
    expect(fs.readFileSync(store.file)).toEqual(before);
  });

  it.each(['expired', 'role', 'submit-permission', 'scope'])(
    'denies invalid trusted-context authorization (%s)',
    async (kind) => {
      if (kind === 'expired') principal.expiresAt = 0;
      if (kind === 'role') Object.assign(principal, { role: 'agent' });
      if (kind === 'submit-permission') principal.permissions = ['director.read'];
      if (kind === 'scope') principal.scopes = [{ ...scope, projectId: 'another-project' }];
      await expect(director().receive(input(), session)).rejects.toThrow();
      expect((await store.read())?.data.tasks).toHaveLength(0);
    },
  );

  it('checks session expiration again after asynchronous preflight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const p = policy();
    const original = p.assessAssignment.bind(p);
    vi.spyOn(p, 'assessAssignment').mockImplementationOnce(async (request) => {
      vi.setSystemTime(principal.expiresAt + 1);
      return original(request);
    });
    await expect(director(p).receive(input(), session)).rejects.toMatchObject({
      code: 'DIRECTOR_NOT_AUTHORIZED',
    });
    expect((await store.read())?.data.tasks).toHaveLength(0);
  });

  it('denies body-selected foreign scope and mismatched storage before persisting', async () => {
    await expect(
      director().receive({ ...input(), scope: { ...scope, clientId: 'other-client' } }, session),
    ).rejects.toMatchObject({ code: 'DIRECTOR_SCOPE_NOT_AUTHORIZED' });
    const other = { ...scope, projectId: 'another-project' };
    principal.scopes = [scope, other];
    await expect(
      director(policy(), store, other).receive({ ...input(), scope: other }, session),
    ).rejects.toMatchObject({ code: 'DIRECTOR_STORAGE_SCOPE_MISMATCH' });
    expect((await store.read())?.data.tasks).toHaveLength(0);
  });

  it('does not grant capabilities automatically to Carlos or a proposed assignee', async () => {
    const blockedCarlos = await director(policy([])).receive(input(), session);
    expect(blockedCarlos.demand).toMatchObject({
      status: 'blocked',
      responsibleAgentId: 'carlos',
      reason: 'CARLOS_EXPLICIT_GRANT_REQUIRED',
    });
    const onlyCarlos = fixtureGrants.filter((grant) => grant.agentId === 'carlos');
    const blockedAssignee = await director(policy(onlyCarlos)).receive(
      { ...input(), requestId: 'request-2' },
      session,
    );
    expect(blockedAssignee.demand).toMatchObject({
      status: 'blocked',
      responsibleAgentId: 'carlos',
      reason: 'EXPLICIT_GRANT_REQUIRED',
      classification: { proposedAgentId: 'andre' },
    });
  });

  it('records approval-required eligibility without creating or consuming approvals', async () => {
    const grants = fixtureGrants.map((grant) => ({
      ...grant,
      requireApproval: grant.agentId === 'andre',
    }));
    const result = await director(policy(grants)).receive(input(), session);
    expect(result.demand).toMatchObject({
      status: 'approval_required',
      responsibleAgentId: 'carlos',
      reason: 'ASSIGNEE_APPROVAL_REQUIRED',
    });
    expect((await store.read())?.data.events).toHaveLength(2);
    expect((await store.read())?.data.approvals).toHaveLength(0);
  });

  it.each([
    'local.execute',
    'external.request',
    'publication.publish',
    'proposal.finalize',
    'commercial.commit',
    'money.spend',
    'data.delete',
  ] as const)(
    'records unsupported or sensitive actions as blocked (%s)',
    async (requestedAction) => {
      const result = await director().receive({ ...input(), requestedAction }, session);
      expect(result.demand).toMatchObject({
        status: 'blocked',
        responsibleAgentId: 'carlos',
        executionAllowed: false,
        reason: 'SENSITIVE_OR_EXECUTABLE_ACTION_NOT_SUPPORTED',
      });
    },
  );

  it('does not treat a request to publish as an internal draft', async () => {
    const result = await director().receive(
      { ...input(), description: 'Publicar o resultado imediatamente.' },
      session,
    );
    expect(result.demand.status).toBe('blocked');
  });

  it('does not reinterpret a conflicting requested internal action silently', async () => {
    const result = await director().receive(
      { ...input(), requestedAction: 'internal.analyze' },
      session,
    );
    expect(result.demand).toMatchObject({
      status: 'needs_clarification',
      reason: 'INTENT_ACTION_MISMATCH',
    });
  });

  it('survives restart and returns an independent query result', async () => {
    const first = await director().receive(input(), session);
    const restarted = new Md2Storage({ root, scope });
    const d = director(policy(fixtureGrants, restarted), restarted);
    const queried = (await d.get(first.demand.id, session))!;
    expect(queried).toEqual(first.demand);
    queried.history.length = 0;
    expect((await d.get(first.demand.id, session))?.history).toHaveLength(2);
    expect(await d.get('demand-' + 'f'.repeat(48), session)).toBeNull();
  });

  it('enforces read permission and original submitter identity even in the same project', async () => {
    const first = await director().receive(input(), session);
    principal.permissions = ['director.submit'];
    await expect(director().get(first.demand.id, session)).rejects.toMatchObject({
      code: 'DIRECTOR_NOT_AUTHORIZED',
    });
    principal.permissions = ['director.read'];
    principal.subjectId = 'another-test-ceo';
    await expect(director().get(first.demand.id, session)).rejects.toMatchObject({
      code: 'DIRECTOR_NOT_AUTHORIZED',
    });
  });

  it('keeps identical request keys isolated by project', async () => {
    const first = await director().receive(input(), session);
    const otherScope = { ...scope, projectId: 'other-project' };
    principal.scopes = [scope, otherScope];
    const other = new Md2Storage({ root, scope: otherScope });
    await other.initialize();
    const d = director(policy(fixtureGrants, other, otherScope), other, otherScope);
    const second = await d.receive({ ...input(), scope: otherScope }, session);
    expect(second.demand.id).not.toBe(first.demand.id);
    expect(await d.get(first.demand.id, session)).toBeNull();
    expect(await director().get(second.demand.id, session)).toBeNull();
  });

  it('deduplicates repeated and concurrent submissions and rejects conflicting bodies', async () => {
    const results = await Promise.all([
      director().receive(input(), session),
      director().receive(input(), session),
    ]);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(results[0].demand.id).toBe(results[1].demand.id);
    const before = fs.readFileSync(store.file);
    expect((await director().receive(input(), session)).duplicate).toBe(true);
    await expect(
      director().receive({ ...input(), title: 'Outro conteúdo' }, session),
    ).rejects.toMatchObject({ code: 'DIRECTOR_IDEMPOTENCY_CONFLICT' });
    expect(fs.readFileSync(store.file)).toEqual(before);
    expect((await store.read())?.data.tasks).toHaveLength(1);
  });

  it('does not leave half a demand after a write failure and permits safe retry', async () => {
    const broken: SecurityStore = {
      read: () => store.read(),
      commit: async () => {
        throw new Error('Simulated intake write failure');
      },
    };
    await expect(director(policy(), broken).receive(input(), session)).rejects.toThrow('Simulated');
    expect((await store.read())?.data.tasks).toHaveLength(0);
    expect((await store.read())?.data.events).toHaveLength(0);
    expect((await director().receive(input(), session)).duplicate).toBe(false);
  });

  it('deduplicates a retry after the commit succeeded but acknowledgement failed', async () => {
    const uncertain: SecurityStore = {
      read: () => store.read(),
      commit: async (changes, revision) => {
        await store.commit(changes, revision);
        throw new Error('Simulated acknowledgement failure');
      },
    };
    await expect(director(policy(), uncertain).receive(input(), session)).rejects.toThrow(
      'Simulated acknowledgement',
    );
    expect((await director().receive(input(), session)).duplicate).toBe(true);
    expect((await store.read())?.data.tasks).toHaveLength(1);
    expect((await store.read())?.data.events).toHaveLength(2);
  });

  it('redacts credential input, keeps it for clarification and never persists the raw secret', async () => {
    const result = await director().receive(
      { ...input(), description: 'Considerar api_key=example-value' },
      session,
    );
    expect(result.demand).toMatchObject({
      status: 'needs_clarification',
      redacted: true,
      reason: 'SENSITIVE_INPUT_REDACTED',
    });
    expect(result.demand.description).toContain('[REDACTED]');
    expect(fs.readFileSync(store.file, 'utf8')).not.toContain('example-value');
    expect(fs.readFileSync(store.file + '.backup', 'utf8')).not.toContain('example-value');
  });

  it('reads limits without allocating budget, starting work or claiming unknown consumption as zero', async () => {
    await store.commit(
      {
        tasks: [
          {
            id: 'existing-task',
            agentId: 'andre',
            status: 'created',
            prompt: 'Test fixture.',
            output: '',
          },
        ],
      },
      1,
    );
    const l = new Md2Limits(store, {
      scope,
      task: { maxAttempts: 1, maxTokens: 10, maxCostMicros: 10 },
      agent: { maxAttempts: 1, maxTokens: 10, maxCostMicros: 10 },
      project: { maxAttempts: 1, maxTokens: 10, maxCostMicros: 10 },
      budget: {
        id: 'test-budget',
        scope,
        expiresAt: Date.now() + 60000,
        currency: 'USD',
        maxTokens: 10,
        maxCostMicros: 10,
      },
    });
    const reservation = await l.reserve('existing-task', 'andre', { tokens: 1, costMicros: 1 });
    await l.settle(reservation.attemptId, { tokens: null, costMicros: null });
    const before = await l.usage();
    const result = await director().receive(input(), session);
    expect(result.demand.hasUnknownConsumption).toBe(true);
    expect(result.demand.executionAllowed).toBe(false);
    expect(await l.usage()).toEqual(before);
  });

  it('fails closed on inconsistent director metadata and preserves the file', async () => {
    const first = await director().receive(input(), session);
    const snapshot = (await store.read())!;
    const record = JSON.parse(snapshot.data.events[1].message);
    record.classification.proposedAgentId = 'unknown';
    snapshot.data.events[1].message = JSON.stringify(record);
    const { checksum: previousChecksum, ...payload } = snapshot;
    void previousChecksum;
    fs.writeFileSync(store.file, JSON.stringify(seal(payload)));
    const before = fs.readFileSync(store.file);
    await expect(director().get(first.demand.id, session)).rejects.toMatchObject({
      code: 'DIRECTOR_INVALID_LEDGER',
    });
    expect(fs.readFileSync(store.file)).toEqual(before);
  });

  it.each([
    null,
    {},
    { title: 'Missing fields' },
    { ...input(), agentId: 'carlos' },
    { ...input(), intent: 'unknown' },
    { ...input(), urgency: ['high'] },
    { ...input(), description: ' ' },
  ])('rejects invalid or identity/assignment-injecting bodies (%#)', async (body) => {
    await expect(director().receive(body, session)).rejects.toThrow();
    expect((await store.read())?.data.tasks).toHaveLength(0);
  });

  it('does not turn assignment eligibility into actual execution authorization', async () => {
    const p = policy();
    expect(
      await p.assessAssignment({
        agentId: 'andre',
        capability: 'code.draft',
        kind: 'internal.draft',
        scope,
      }),
    ).toEqual({ eligibility: 'eligible' });
    await expect(
      p.evaluate({
        id: 'assignment-preflight',
        taskId: 'assignment-preflight',
        agentId: 'andre',
        capability: 'code.draft',
        kind: 'internal.draft',
        scope,
        resource: { scope, id: 'assignment-preflight' },
        parameters: {},
      }),
    ).rejects.toMatchObject({ code: 'TASK_SCOPE_OR_STATE' });
    expect((await store.read())?.data.tasks).toHaveLength(0);
  });
});
