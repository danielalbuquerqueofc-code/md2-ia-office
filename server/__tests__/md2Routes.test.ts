import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { Md2Worker } from '../src/md2/executor.js';
import { Md2Limits } from '../src/md2/limits.js';
import { Md2Office } from '../src/md2/office.js';
import {
  hashOperatorSecret,
  type OperatorConfig,
  type OperatorCredential,
} from '../src/md2/operatorAuth.js';
import { registerMd2Routes } from '../src/md2/routes.js';
import { createMd2Runtime, type Md2Runtime, simulatedWorker } from '../src/md2/runtime.js';

const scope = { clientId: 'routes-client', projectId: 'routes-project' };
const SECRET = 'routes-operator-secret';
const READER_SECRET = 'routes-reader-secret';
const zero = { maxAttempts: 0, maxTokens: 0, maxCostMicros: 0 };
const gate = { authorization: 'Bearer server-token', host: 'localhost' };

describe('MD2 protected routes (MD2_EXECUTOR_ENABLED)', () => {
  let credential: OperatorCredential;
  let readerCredential: OperatorCredential;
  let root: string;
  let app: FastifyInstance;
  let runtime: Md2Runtime;
  let launches: number;

  beforeAll(async () => {
    credential = await hashOperatorSecret(SECRET, 16384);
    readerCredential = await hashOperatorSecret(READER_SECRET, 16384);
  });
  beforeEach(() => {
    runtime = undefined as unknown as Md2Runtime;
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-routes-'));
    launches = 0;
  });
  afterEach(async () => {
    await app?.close();
    if (runtime) {
      const l = new Md2Limits(runtime.store, { scope, task: zero, agent: zero, project: zero });
      for (const id of (await l.usage()).activeAttemptIds)
        await l.settle(id, { tokens: 0, costMicros: 0 });
      await l.synchronize();
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  function office() {
    return new Md2Office({
      store: new AgentStateStore(),
      cwd: root,
      command: 'never-run',
      ledger: path.join(root, 'legacy', 'tasks.json'),
      clientFactory: () => {
        launches += 1;
        throw new Error('legacy launch must not happen in these tests');
      },
    });
  }
  async function build(worker: Md2Worker | 'simulated' = 'simulated') {
    runtime = await createMd2Runtime({
      scope,
      dataRoot: path.join(root, 'data'),
      operators: {
        version: 1,
        operators: [
          {
            subjectId: 'ana-ceo',
            roles: ['ceo', 'reviewer', 'operator'],
            permissions: [
              'director.submit',
              'director.read',
              'queue.read',
              'queue.operate',
              'approval.decide',
            ],
            scopes: [scope],
            credential,
          },
          {
            subjectId: 'otto-reader',
            roles: ['operator'],
            permissions: ['queue.read'],
            scopes: [scope],
            credential: readerCredential,
          },
        ],
      } as unknown as OperatorConfig,
      worker,
      allocation: { tokens: 10, costMicros: 1 },
      limits: {
        task: { maxAttempts: 3, maxTokens: 100, maxCostMicros: 10 },
        agent: { maxAttempts: 50, maxTokens: 1000, maxCostMicros: 100 },
        project: { maxAttempts: 100, maxTokens: 1000, maxCostMicros: 100 },
      },
      budget: {
        id: 'routes-budget',
        scope,
        currency: 'USD',
        maxTokens: 1000,
        maxCostMicros: 100,
        expiresAt: Date.now() + 3600000,
      },
    });
    app = Fastify();
    registerMd2Routes(app, {
      token: 'server-token',
      store: new AgentStateStore(),
      allowedHostnames: new Set(['localhost']),
      office: office(),
      runtime,
    });
    return runtime;
  }
  function call(method: 'GET' | 'POST', url: string, token?: string, payload?: object) {
    return app.inject({
      method,
      url: '/api/md2' + url,
      headers: { ...gate, ...(token ? { 'x-md2-session': token } : {}) },
      ...(payload ? { payload } : {}),
    });
  }
  async function login(subjectId = 'ana-ceo', secret = SECRET) {
    const response = await call('POST', '/operator/login', undefined, { subjectId, secret });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    return response.json().token as string;
  }
  async function queued(token: string, requestId = 'lead-request-1') {
    const demand = await call('POST', '/demands', token, {
      requestId,
      title: 'Prospecção de clínicas',
      description: 'Analisar a lista fornecida pelo operador e priorizar contatos.',
      intent: 'commercial.prospect',
    });
    expect(demand.statusCode).toBe(201);
    expect(demand.json().demand).toMatchObject({
      status: 'classified',
      responsibleAgentId: 'lucas',
    });
    const item = await call('POST', '/queue', token, { demandId: demand.json().demand.id });
    expect(item.statusCode).toBe(201);
    return item.json().item as { id: string; state: string; reason: string | null };
  }
  async function approve(token: string, id: string) {
    const request = await call('POST', `/queue/${id}/approval`, token);
    expect(request.statusCode).toBe(201);
    const { requestId, digest, action } = request.json();
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(action).toMatchObject({ agentId: 'lucas', kind: 'internal.analyze' });
    const decided = await call('POST', `/queue/${id}/approval/${requestId}/decide`, token, {
      decision: 'approve',
      secret: SECRET,
    });
    expect(decided.statusCode).toBe(200);
    return decided.json();
  }

  it('does not register the protected API when the flag is off', async () => {
    app = Fastify();
    registerMd2Routes(app, {
      token: 'server-token',
      store: new AgentStateStore(),
      allowedHostnames: new Set(['localhost']),
      office: office(),
    });
    const login = await call('POST', '/operator/login', undefined, {
      subjectId: 'x',
      secret: 'y',
    });
    expect(login.statusCode).toBe(404);
  });

  it('fails closed when the flag is on but the runtime is unavailable', async () => {
    app = Fastify();
    registerMd2Routes(app, {
      token: 'server-token',
      store: new AgentStateStore(),
      allowedHostnames: new Set(['localhost']),
      office: office(),
      runtime: null,
    });
    expect(
      (await call('POST', '/operator/login', undefined, { subjectId: 'x', secret: 'y' })).json(),
    ).toEqual({ error: 'RUNTIME_UNAVAILABLE' });
    expect((await call('POST', '/tasks', undefined, { prompt: 'Executar' })).statusCode).toBe(409);
    expect(launches).toBe(0);
  });

  it('keeps the server gate and disables the legacy launch while the executor is on', async () => {
    await build();
    expect(
      (await app.inject({ method: 'POST', url: '/api/md2/operator/login', payload: {} }))
        .statusCode,
    ).toBe(401);
    expect((await call('POST', '/tasks', undefined, { prompt: 'Executar' })).statusCode).toBe(409);
    expect(launches).toBe(0);
    expect((await call('POST', '/demands', undefined, {})).statusCode).toBe(400);
    expect(
      (
        await call('POST', '/demands', undefined, {
          requestId: 'x',
          title: 'x',
          description: 'x',
        })
      ).json(),
    ).toEqual({ error: 'SESSION_REQUIRED' });
    expect(
      (await call('POST', '/operator/login', undefined, { subjectId: 'ana-ceo', secret: 'nope' }))
        .statusCode,
    ).toBe(401);
  });

  it('runs the full flow: demand, queue, exact human approval, simulated run', async () => {
    await build();
    const token = await login();
    const reader = await login('otto-reader', READER_SECRET);
    const item = await queued(token);
    expect(item).toMatchObject({ state: 'blocked', reason: 'APPROVAL_REQUIRED' });

    // Without approval nothing runs.
    expect((await call('POST', '/executor/run-next', token, { wait: true })).json()).toEqual({
      report: null,
    });
    // Read-only operators can look but not act.
    expect((await call('GET', '/queue-state', reader)).statusCode).toBe(200);
    expect((await call('POST', '/executor/run-next', reader, { wait: true })).statusCode).toBe(403);
    expect((await call('POST', `/queue/${item.id}/approval`, reader)).statusCode).toBe(403);

    // Wrong secret on the approval: refused and nothing attached.
    const pending = (await call('POST', `/queue/${item.id}/approval`, token)).json();
    const wrong = await call(
      'POST',
      `/queue/${item.id}/approval/${pending.requestId}/decide`,
      token,
      { decision: 'approve', secret: 'wrong-secret-value' },
    );
    expect(wrong.statusCode).toBe(401);

    // One pending request per exact action: a second request is refused, the first is reused.
    expect((await call('POST', `/queue/${item.id}/approval`, token)).statusCode).toBe(409);
    const approved = (
      await call('POST', `/queue/${item.id}/approval/${pending.requestId}/decide`, token, {
        decision: 'approve',
        secret: SECRET,
      })
    ).json();
    expect(approved.item).toMatchObject({ state: 'queued' });

    const run = await call('POST', '/executor/run-next', token, { wait: true });
    expect(run.statusCode).toBe(200);
    expect(run.json().report).toMatchObject({ workId: item.id, state: 'completed' });
    const state = (await call('GET', '/queue-state', token)).json();
    expect(state).toMatchObject({ worker: 'simulated', running: false });
    expect(state.counts.completed).toBe(1);
    expect((await call('GET', `/queue/${item.id}`, reader)).json().state).toBe('completed');
    expect(
      (await runtime.store.read())?.data.agents.every((agent) => agent.status === 'inactive'),
    ).toBe(true);

    expect((await call('POST', '/operator/logout', token)).statusCode).toBe(200);
    expect((await call('GET', '/operator/me', token)).statusCode).toBe(401);
  });

  it('refuses overlapping runs through the API (global limit of 1)', async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const gated: Md2Worker = {
      run: async (input, signal) => {
        await hold;
        return simulatedWorker.run(input, signal);
      },
    };
    await build(gated);
    const token = await login();
    const first = await queued(token, 'lead-request-a');
    await approve(token, first.id);
    expect((await call('POST', '/executor/run-next', token)).statusCode).toBe(202);
    expect((await call('POST', '/executor/run-next', token)).json()).toEqual({
      error: 'EXECUTOR_BUSY',
    });
    expect((await call('GET', '/queue-state', token)).json().running).toBe(true);
    release();
    await runtime.run.active;
    expect((await call('GET', '/queue-state', token)).json()).toMatchObject({
      running: false,
      lastReport: { workId: first.id, state: 'completed' },
    });
  });

  it('answers 503 for execution when no worker is enabled', async () => {
    runtime = await createMd2Runtime({
      scope,
      dataRoot: path.join(root, 'data-disabled'),
      operators: {
        version: 1,
        operators: [
          {
            subjectId: 'ana-ceo',
            roles: ['operator'],
            permissions: ['queue.read', 'queue.operate'],
            scopes: [scope],
            credential,
          },
        ],
      } as unknown as OperatorConfig,
      worker: 'disabled',
      allocation: { tokens: 10, costMicros: 1 },
      limits: { task: zero, agent: zero, project: zero },
    });
    app = Fastify();
    registerMd2Routes(app, {
      token: 'server-token',
      store: new AgentStateStore(),
      allowedHostnames: new Set(['localhost']),
      office: office(),
      runtime,
    });
    const token = await login();
    expect((await call('POST', '/executor/run-next', token, { wait: true })).json()).toEqual({
      error: 'EXECUTOR_WORKER_DISABLED',
    });
  });

  it('refuses a data root inside the server checkout', async () => {
    await expect(
      createMd2Runtime({
        scope,
        dataRoot: path.join(process.cwd(), 'md2-data'),
        operators: { version: 1, operators: [] } as unknown as OperatorConfig,
        worker: 'disabled',
        allocation: { tokens: 1, costMicros: 1 },
        limits: { task: zero, agent: zero, project: zero },
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_DATA_ROOT_INSIDE_CHECKOUT' });
  });

  it('adds aggregate queue counts to the office state only when the executor is on', async () => {
    await build();
    const token = await login();
    await queued(token, 'lead-request-state');
    const state = (await call('GET', '/state')).json();
    expect(state.queue).toMatchObject({
      available: true,
      worker: 'simulated',
      running: false,
      counts: { blocked: 1, queued: 0, completed: 0 },
    });
    expect(JSON.stringify(state.queue)).not.toContain('Prospecção');
    await app.close();
    app = Fastify();
    registerMd2Routes(app, {
      token: 'server-token',
      store: new AgentStateStore(),
      allowedHostnames: new Set(['localhost']),
      office: office(),
    });
    expect((await call('GET', '/state')).json().queue).toBeUndefined();
  });

  describe('commercial pilot (internal only)', () => {
    const hotLead = {
      reference: 'clinica-sol-001',
      company: 'Clínica Sol',
      contactName: 'Marina',
      role: 'Diretora comercial',
      segment: 'saúde',
      source: 'indicacao',
      need: 'Organizar a captação de pacientes e reduzir faltas em consultas.',
    };

    it('registers leads idempotently and lets read-only operators only look', async () => {
      await build();
      const token = await login();
      const reader = await login('otto-reader', READER_SECRET);
      const created = await call('POST', '/pilot/leads', token, hotLead);
      expect(created.statusCode).toBe(201);
      const lead = created.json().lead;
      expect(lead).toMatchObject({ company: 'Clínica Sol', stage: 'new', registeredBy: 'ana-ceo' });
      const again = await call('POST', '/pilot/leads', token, hotLead);
      expect(again.statusCode).toBe(200);
      expect(again.json().lead.id).toBe(lead.id);
      expect(
        (await call('POST', '/pilot/leads', reader, { ...hotLead, reference: 'other' })).statusCode,
      ).toBe(403);
      expect((await call('GET', '/pilot/leads', reader)).json()).toHaveLength(1);
      expect((await call('GET', '/pilot/leads', undefined)).statusCode).toBe(401);
    });

    it('refuses contact data and secrets in lead fields', async () => {
      await build();
      const token = await login();
      for (const notes of ['marina@clinicasol.com.br', 'ligar para +55 11 98765-4321'])
        expect(
          (
            await call('POST', '/pilot/leads', token, {
              ...hotLead,
              reference: 'sensitive-' + notes.length,
              notes,
            })
          ).json(),
        ).toEqual({ error: 'PILOT_SENSITIVE_DATA' });
      expect((await call('GET', '/pilot/leads', token)).json()).toHaveLength(0);
    });

    it('classifies, prepares unsendable drafts and organizes internal actions', async () => {
      await build();
      const token = await login();
      const hot = (await call('POST', '/pilot/leads', token, hotLead)).json().lead;
      const cold = (
        await call('POST', '/pilot/leads', token, {
          reference: 'loja-x-002',
          company: 'Loja X',
          source: 'manual',
        })
      ).json().lead;
      expect((await call('POST', `/pilot/leads/${hot.id}/classify`, token)).json()).toMatchObject({
        stage: 'hot',
        owner: 'rafael',
        score: 7,
      });
      expect((await call('POST', `/pilot/leads/${cold.id}/classify`, token)).json()).toMatchObject({
        stage: 'cold',
        owner: 'lucas',
      });

      const draft = await call('POST', `/pilot/leads/${hot.id}/messages`, token, {
        kind: 'proposal',
      });
      expect(draft.statusCode).toBe(201);
      expect(draft.json()).toMatchObject({
        kind: 'proposal',
        author: 'rafael',
        status: 'draft',
        sendable: false,
      });
      expect(draft.json().text).toContain('Clínica Sol');
      // There is no send endpoint at all.
      expect(
        (await call('POST', `/pilot/leads/${hot.id}/messages/${draft.json().id}/send`, token))
          .statusCode,
      ).toBe(404);

      const action = await call('POST', `/pilot/leads/${hot.id}/actions`, token, {
        title: 'Revisar minuta com o time comercial',
        owner: 'carlos',
        dueDate: '2026-11-03',
      });
      expect(action.statusCode).toBe(201);
      expect(
        (
          await call('POST', `/pilot/leads/${hot.id}/actions`, token, {
            title: 'x',
            owner: 'mariana',
            dueDate: '2026-11-03',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('POST', `/pilot/leads/${hot.id}/actions`, token, {
            title: 'x',
            owner: 'lucas',
            dueDate: 'amanhã',
          })
        ).statusCode,
      ).toBe(400);
      const done = await call(
        'POST',
        `/pilot/leads/${hot.id}/actions/${action.json().id}/complete`,
        token,
      );
      expect(done.json().actions).toMatchObject([{ done: true, owner: 'carlos' }]);
      const listed = (await call('GET', `/pilot/leads/${hot.id}`, token)).json();
      expect(listed.messages).toHaveLength(1);
      expect(
        (await runtime.store.read())?.data.agents.every((agent) => agent.status === 'inactive'),
      ).toBe(true);
    });
  });
});
