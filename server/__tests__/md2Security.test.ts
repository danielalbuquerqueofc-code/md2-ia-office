import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type LimitsConfiguration, Md2Limits } from '../src/md2/limits.js';
import { actionDigest, Md2Policy, type PolicyAction, type PolicyGrant } from '../src/md2/policy.js';
import { redactMd2Text } from '../src/md2/sanitize.js';
import { Md2Storage } from '../src/md2/storage.js';

const scope = { clientId: 'client-a', projectId: 'project-a' };
const grants: PolicyGrant[] = [
  { agentId: 'andre', capability: 'code.draft', kind: 'local.execute', requireApproval: false },
];
function action(): PolicyAction {
  return {
    id: 'action-1',
    taskId: 'task-1',
    agentId: 'andre',
    capability: 'code.draft',
    kind: 'local.execute',
    scope: { ...scope },
    resource: { scope: { ...scope }, id: 'project-source' },
    parameters: { command: 'node --test sample.test.js', files: ['sample.test.js'] },
  };
}
function configuration(): LimitsConfiguration {
  return {
    scope: { ...scope },
    maxConcurrentExecutors: 1,
    task: { maxAttempts: 2, maxTokens: 100, maxCostMicros: 100 },
    agent: { maxAttempts: 4, maxTokens: 200, maxCostMicros: 200 },
    project: { maxAttempts: 8, maxTokens: 400, maxCostMicros: 400 },
    budget: {
      id: 'budget-1',
      scope: { ...scope },
      expiresAt: Date.now() + 3600000,
      currency: 'USD',
      maxTokens: 400,
      maxCostMicros: 400,
    },
  };
}

describe('MD2 security policies and operational limits', () => {
  let root: string;
  let store: Md2Storage;
  const instances = new Set<Md2Limits>();
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-security-'));
    store = new Md2Storage({ root, scope });
    await store.initialize();
    await store.commit(
      {
        tasks: ['task-1', 'task-2'].map((id) => ({
          id,
          agentId: 'andre',
          status: 'created',
          prompt: 'Preparar análise.',
          output: '',
        })),
      },
      1,
    );
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const limits of instances) {
      try {
        for (const id of (await limits.usage()).activeAttemptIds)
          await limits.settle(id, { tokens: null, costMicros: null });
      } catch {
        /* No live executors exist in these tests. */
      }
    }
    instances.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function policy(custom = grants, reviewers = ['operator-1']) {
    return new Md2Policy(store, { scope, grants: custom, reviewerIds: reviewers });
  }
  function limits(config = configuration(), source = store) {
    const result = new Md2Limits(source, config);
    instances.add(result);
    return result;
  }

  it('does not convert declarative capabilities into execution permission', async () => {
    const defaultPolicy = new Md2Policy(store, { scope });
    expect(await defaultPolicy.evaluate(action())).toEqual({
      decision: 'deny',
      reason: 'EXPLICIT_GRANT_REQUIRED',
    });
    expect((await policy().evaluate(action())).decision).toBe('approval-required');
    expect((await store.read())?.data.agents.every((agent) => agent.status === 'inactive')).toBe(
      true,
    );
  });

  it('permits internal drafting only through an explicit matching grant', async () => {
    const draft = { ...action(), kind: 'internal.draft' as const };
    expect((await policy().evaluate(draft)).decision).toBe('deny');
    const p = policy([
      {
        agentId: 'andre',
        capability: 'code.draft',
        kind: 'internal.draft',
        requireApproval: false,
      },
    ]);
    expect((await p.evaluate(draft)).decision).toBe('allow');
  });

  it.each([
    'external.request',
    'publication.publish',
    'proposal.finalize',
    'commercial.commit',
    'money.spend',
    'data.delete',
    'unknown',
  ])('denies sensitive or unknown actions by default (%s)', async (kind) => {
    const requested = { ...action(), kind } as PolicyAction;
    expect(await policy().evaluate(requested)).toEqual({
      decision: 'deny',
      reason: 'ACTION_DENIED_BY_DEFAULT',
    });
    await expect(policy().requestApproval(requested)).rejects.toThrow();
  });

  it('denies other client/project resources and agents without the requested capability', async () => {
    const otherClient = action();
    otherClient.scope.clientId = 'client-b';
    expect(await policy().evaluate(otherClient)).toEqual({
      decision: 'deny',
      reason: 'CROSS_SCOPE',
    });
    const otherProject = action();
    otherProject.resource.scope.projectId = 'project-b';
    expect(await policy().evaluate(otherProject)).toEqual({
      decision: 'deny',
      reason: 'CROSS_SCOPE',
    });
    expect(await policy().evaluate({ ...action(), capability: 'finance.analyze' })).toEqual({
      decision: 'deny',
      reason: 'CAPABILITY_NOT_DECLARED',
    });
    await expect(policy().evaluate({ ...action(), taskId: 'task-unknown' })).rejects.toMatchObject({
      code: 'TASK_SCOPE_OR_STATE',
    });
  });

  it('binds approvals to exact actions while ignoring JSON property order', async () => {
    const p = policy();
    const original = action();
    const reordered = {
      ...original,
      parameters: { files: ['sample.test.js'], command: 'node --test sample.test.js' },
    };
    expect(actionDigest(original)).toBe(actionDigest(reordered));
    const requested = await p.requestApproval(original);
    const changed = { ...original, parameters: { command: 'node another-file.js' } };
    await expect(
      p.decide(requested.requestId, changed, 'approve', 'operator-1'),
    ).rejects.toMatchObject({ code: 'APPROVAL_MISMATCH_EXPIRED_OR_USED' });
    await p.decide(requested.requestId, reordered, 'approve', 'operator-1');
    expect(await p.consume(requested.requestId, reordered)).toEqual({
      actionId: original.id,
      digest: actionDigest(original),
    });
    await expect(p.consume(requested.requestId, original)).rejects.toThrow();
    await expect(p.requestApproval(original)).rejects.toMatchObject({
      code: 'ACTION_ALREADY_REQUESTED',
    });
  });

  it.each(['id', 'taskId', 'agentId', 'capability', 'kind', 'scope', 'resource'])(
    'includes %s in the action fingerprint',
    (field) => {
      const original = action();
      const changed: PolicyAction = structuredClone(original);
      if (field === 'scope') changed.scope.projectId = 'other-project';
      else if (field === 'resource') changed.resource.id = 'other-resource';
      else
        Object.assign(changed, {
          [field]:
            field === 'kind'
              ? 'internal.draft'
              : field === 'capability'
                ? 'tests.plan'
                : 'another-id',
        });
      expect(actionDigest(changed)).not.toBe(actionDigest(original));
    },
  );

  it('requires an authorized reviewer and honors a decline', async () => {
    const p = policy();
    const requested = await p.requestApproval(action());
    expect(() => p.decide(requested.requestId, action(), 'approve', 'unknown-operator')).toThrow();
    await expect(p.consume(requested.requestId, action())).rejects.toThrow();
    await p.decide(requested.requestId, action(), 'decline', 'operator-1');
    await expect(
      p.decide(requested.requestId, action(), 'approve', 'operator-1'),
    ).rejects.toThrow();
    await expect(p.consume(requested.requestId, action())).rejects.toThrow();
  });

  it('expires before decision and before consumption without a scheduler', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const p = policy();
    const first = await p.requestApproval(action(), 100);
    vi.setSystemTime(Date.now() + 100);
    await expect(p.decide(first.requestId, action(), 'approve', 'operator-1')).rejects.toThrow();
    const other = { ...action(), id: 'action-2' };
    const second = await p.requestApproval(other, 100);
    await p.decide(second.requestId, other, 'approve', 'operator-1');
    vi.setSystemTime(Date.now() + 100);
    await expect(p.consume(second.requestId, other)).rejects.toThrow();
  });

  it('persists approval use across restarts and prevents concurrent reuse', async () => {
    const p = policy();
    const requested = await p.requestApproval(action());
    await p.decide(requested.requestId, action(), 'approve', 'operator-1');
    const results = await Promise.allSettled([
      policy().consume(requested.requestId, action()),
      policy().consume(requested.requestId, action()),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(
      new Md2Policy(new Md2Storage({ root, scope }), {
        scope,
        grants,
        reviewerIds: ['operator-1'],
      }).consume(requested.requestId, action()),
    ).rejects.toThrow();
  });

  it('does not honor approved actions after grants or reviewer authority are removed', async () => {
    const p = policy();
    const requested = await p.requestApproval(action());
    await p.decide(requested.requestId, action(), 'approve', 'operator-1');
    await expect(policy([]).consume(requested.requestId, action())).rejects.toThrow();
    await expect(policy(grants, []).consume(requested.requestId, action())).rejects.toThrow();
  });

  it('does not release authorization when the consumption audit cannot be persisted', async () => {
    const p = policy();
    const request = await p.requestApproval(action());
    await p.decide(request.requestId, action(), 'approve', 'operator-1');
    const failing = new Md2Policy(
      {
        read: () => store.read(),
        commit: async () => {
          throw new Error('Simulated write failure');
        },
      },
      { scope, grants, reviewerIds: ['operator-1'] },
    );
    await expect(failing.consume(request.requestId, action())).rejects.toThrow(
      'Simulated write failure',
    );
    expect((await p.consume(request.requestId, action())).actionId).toBe('action-1');
    await expect(p.consume(request.requestId, action())).rejects.toThrow();
  });

  it('rejects sensitive action previews instead of approving a redacted substitute', async () => {
    await expect(
      policy().requestApproval({ ...action(), parameters: { command: 'password=example-value' } }),
    ).rejects.toThrow();
    expect(fs.readFileSync(store.file, 'utf8')).not.toContain('example-value');
    expect(() => actionDigest({ ...action(), parameters: { value: Infinity } })).toThrow();
    expect(() => actionDigest({ ...action(), parameters: { value: 'x'.repeat(17000) } })).toThrow();
  });

  it('blocks execution without a valid, unexpired, scope-specific budget', async () => {
    const absent = configuration();
    delete absent.budget;
    await expect(
      limits(absent).reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
    ).rejects.toMatchObject({ code: 'BUDGET_NOT_AUTHORIZED' });
    const expired = configuration();
    expired.budget!.expiresAt = 0;
    await expect(
      limits(expired).reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
    ).rejects.toMatchObject({ code: 'BUDGET_NOT_AUTHORIZED' });
    const foreign = configuration();
    foreign.budget!.scope.clientId = 'other-client';
    expect(() => limits(foreign)).toThrow();
  });

  it('enforces one global executor across instances and projects', async () => {
    const first = limits();
    const otherScope = { ...scope, projectId: 'project-b' };
    const otherStore = new Md2Storage({ root, scope: otherScope });
    await otherStore.initialize();
    await otherStore.commit(
      {
        tasks: [
          { id: 'task-1', agentId: 'andre', status: 'created', prompt: 'Análise.', output: '' },
        ],
      },
      1,
    );
    const config = configuration();
    config.scope = otherScope;
    config.budget!.scope = otherScope;
    const second = limits(config, otherStore);
    const results = await Promise.allSettled([
      first.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
      second.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'GLOBAL_EXECUTOR_BUSY' },
    });
    const config2 = {
      ...configuration(),
      maxConcurrentExecutors: 2,
    } as unknown as LimitsConfiguration;
    expect(() => limits(config2)).toThrow();
  });

  it.each(['task', 'agent', 'project'] as const)(
    'enforces configured %s attempt limits',
    async (band) => {
      const config = configuration();
      config[band].maxAttempts = 1;
      const l = limits(config);
      const reserved = await l.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 });
      await l.settle(reserved.attemptId, { tokens: 1, costMicros: 1 });
      await expect(
        l.reserve(band === 'task' ? 'task-1' : 'task-2', 'andre', { tokens: 10, costMicros: 10 }),
      ).rejects.toMatchObject({ code: 'OPERATIONAL_LIMIT_REACHED' });
    },
  );

  it.each(['task', 'agent', 'project'] as const)(
    'enforces %s token and cost ceilings',
    async (band) => {
      for (const metric of ['maxTokens', 'maxCostMicros'] as const) {
        const config = configuration();
        config[band][metric] = 5;
        await expect(
          limits(config).reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
        ).rejects.toMatchObject({ code: 'OPERATIONAL_LIMIT_REACHED' });
      }
    },
  );

  it('accounts measured consumption durably and blocks an exhausted authorized budget', async () => {
    const config = configuration();
    config.budget!.maxCostMicros = 10;
    const l = limits(config);
    const reserved = await l.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 });
    await l.settle(reserved.attemptId, { tokens: 7, costMicros: 10 });
    const restarted = limits(config, new Md2Storage({ root, scope }));
    expect(await restarted.usage()).toMatchObject({
      attempts: 1,
      knownTokens: 7,
      knownCostMicros: 10,
      unknownCost: false,
      heldCostMicros: 0,
    });
    await expect(
      restarted.reserve('task-1', 'andre', { tokens: 1, costMicros: 1 }),
    ).rejects.toMatchObject({ code: 'AUTHORIZED_BUDGET_EXHAUSTED' });
    await expect(
      restarted.settle(reserved.attemptId, { tokens: 0, costMicros: 0 }),
    ).rejects.toThrow();
  });

  it('records unknown consumption separately, retains reservations and blocks until reconciliation', async () => {
    const l = limits();
    const reserved = await l.reserve('task-1', 'andre', { tokens: 20, costMicros: 30 });
    await l.settle(reserved.attemptId, { tokens: 12, costMicros: null });
    expect(await l.usage()).toMatchObject({
      knownTokens: 12,
      knownCostMicros: 0,
      unknownCost: true,
      heldCostMicros: 30,
    });
    await expect(
      limits().reserve('task-2', 'andre', { tokens: 1, costMicros: 1 }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION' });
    await expect(
      l.reconcile(reserved.attemptId, { tokens: 11, costMicros: 8 }),
    ).rejects.toMatchObject({ code: 'KNOWN_CONSUMPTION_IMMUTABLE' });
    await l.reconcile(reserved.attemptId, { tokens: 12, costMicros: 8 });
    expect(await l.usage()).toMatchObject({
      knownCostMicros: 8,
      unknownCost: false,
      heldCostMicros: 0,
    });
    const next = await l.reserve('task-2', 'andre', { tokens: 1, costMicros: 1 });
    await l.settle(next.attemptId, { tokens: 1, costMicros: 1 });
  });

  it('records actual overspend honestly and blocks subsequent allocations', async () => {
    const l = limits();
    const reserved = await l.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 });
    await l.settle(reserved.attemptId, { tokens: 120, costMicros: 150 });
    expect(await l.usage()).toMatchObject({ knownTokens: 120, knownCostMicros: 150 });
    await expect(l.reserve('task-1', 'andre', { tokens: 1, costMicros: 1 })).rejects.toMatchObject({
      code: 'OPERATIONAL_LIMIT_REACHED',
    });
  });

  it('reports both unknown measurements without counting reservations as actual usage', async () => {
    const l = limits();
    const reserved = await l.reserve('task-1', 'andre', { tokens: 20, costMicros: 30 });
    await l.settle(reserved.attemptId, { tokens: null, costMicros: null });
    expect(await limits().usage()).toMatchObject({
      knownTokens: 0,
      knownCostMicros: 0,
      unknownTokens: true,
      unknownCost: true,
      heldTokens: 20,
      heldCostMicros: 30,
    });
    await expect(l.reserve('task-2', 'andre', { tokens: 1, costMicros: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION',
    });
  });

  it('does not grant a reservation when its audit write fails', async () => {
    const broken = new Md2Limits(
      {
        read: () => store.read(),
        commit: async () => {
          throw new Error('Simulated reservation failure');
        },
      },
      configuration(),
    );
    await expect(broken.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 })).rejects.toThrow(
      'Simulated reservation failure',
    );
    const l = limits();
    const reserved = await l.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 });
    await l.settle(reserved.attemptId, { tokens: 1, costMicros: 1 });
    expect((await l.usage()).attempts).toBe(1);
  });

  it('rejects sensitive security metadata before granting a reservation', async () => {
    const config = configuration();
    config.budget!.id = 'sk-proj-' + 'a'.repeat(20);
    await expect(
      limits(config).reserve('task-1', 'andre', { tokens: 10, costMicros: 10 }),
    ).rejects.toMatchObject({ code: 'SENSITIVE_SECURITY_METADATA' });
    expect((await store.read())?.data.events).toHaveLength(0);
  });

  it('fails closed on malformed policy or limits audit events', async () => {
    const snapshot = (await store.read())!;
    await store.commit(
      {
        events: [
          {
            id: 'policy-invalid',
            taskId: 'task-1',
            type: 'approval',
            message: '{"namespace":"md2.policy.v1","taskId":"task-1","state":"approved"}',
          },
          {
            id: 'limits-invalid',
            taskId: 'task-1',
            type: 'status',
            message: '{"namespace":"md2.limits.v1","taskId":"task-1","kind":"reserved"}',
          },
        ],
      },
      snapshot.revision,
    );
    await expect(policy().requestApproval(action())).rejects.toThrow();
    await expect(
      limits().reserve('task-1', 'andre', { tokens: 1, costMicros: 1 }),
    ).rejects.toThrow();
  });

  it('does not reset attempt counters or authorize zero/negative reservations', async () => {
    const config = configuration();
    config.task.maxAttempts = 1;
    const l = limits(config);
    const reserved = await l.reserve('task-1', 'andre', { tokens: 10, costMicros: 10 });
    await l.settle(reserved.attemptId, { tokens: 1, costMicros: 1 });
    await expect(
      limits(config).reserve('task-1', 'andre', { tokens: 1, costMicros: 1 }),
    ).rejects.toThrow();
    for (const reservation of [
      { tokens: 0, costMicros: 1 },
      { tokens: -1, costMicros: 1 },
      { tokens: NaN, costMicros: 1 },
    ])
      expect(() => l.reserve('task-1', 'andre', reservation)).toThrow();
  });

  it('redacts sensitive new records without touching existing history bytes', async () => {
    const before = fs.readFileSync(store.file);
    const snapshot = (await store.read())!;
    const saved = await store.commit(
      {
        events: [
          {
            id: 'note-1',
            taskId: 'task-1',
            type: 'note',
            message: 'Informação password=example-value\u0000',
          },
        ],
      },
      snapshot.revision,
    );
    expect(saved.data.events[0].message).toBe('Informação [REDACTED]');
    expect(fs.readFileSync(store.file + '.backup')).toEqual(before);
    expect(saved.data.tasks).toEqual(snapshot.data.tasks);
    expect(fs.readFileSync(store.file, 'utf8')).not.toContain('example-value');
  });

  it.each([
    'Bearer example-value',
    'Basic ZXhhbXBsZTp2YWx1ZQ==',
    'api_key="example-value"',
    'client_secret=example-value',
    'https://user:example-value@example.test/path',
    '-----BEGIN PRIVATE KEY-----\nexample-value\n-----END PRIVATE KEY-----',
    'abcdefgh.ijklmnop.qrstuvwx',
  ])('redacts common sensitive formats without reflecting secrets in errors (%#)', (text) => {
    expect(redactMd2Text(text)).toContain('[REDACTED]');
    expect(redactMd2Text(text)).not.toContain('example-value');
  });
});
