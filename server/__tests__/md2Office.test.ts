import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { CodexClient } from '../src/md2/codexClient.js';
import { Md2Office } from '../src/md2/office.js';
import { registerMd2Routes } from '../src/md2/routes.js';

type Callbacks = ConstructorParameters<typeof CodexClient>[0];
describe('MD2 programmer and approval boundary', () => {
  let directory: string;
  let office: Md2Office;
  let callbacks: Callbacks;
  let store: AgentStateStore;
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const close = vi.fn();

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'md2-office-'));
    store = new AgentStateStore();
    calls.length = 0;
    close.mockClear();
    office = new Md2Office({
      store,
      cwd: directory,
      command: 'codex',
      ledger: path.join(directory, 'tasks.json'),
      approvalTimeoutMs: 30,
      clientFactory: (options) => {
        callbacks = options;
        return {
          start() {},
          close,
          notify() {},
          request: async (method, params) => {
            calls.push({ method, params });
            if (method === 'config/read')
              return { config: { mcp_servers: { external: { command: 'unused' } } } };
            return method === 'thread/start'
              ? { thread: { id: 'thread-real-protocol' } }
              : { turn: { id: 'turn-1' } };
          },
        };
      },
    });
  });
  afterEach(() => {
    office.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates a character after connection, maps tool events and distinguishes failure from success', async () => {
    const broadcasts: Record<string, unknown>[] = [];
    store.on('broadcast', (message) => {
      broadcasts.push(message);
    });
    const task = await office.launch('Implementar uma página');
    expect(calls.find((call) => call.method === 'thread/start')?.params).toMatchObject({
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
      config: { mcp_servers: { external: { enabled: false } } },
    });
    expect(task.status).toBe('running');
    expect(store.get(task.agentId!)?.providerId).toBe('codex');
    callbacks.onEvent({
      method: 'item/started',
      params: { item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test' } },
    });
    expect(broadcasts).toContainEqual(
      expect.objectContaining({ type: 'agentToolStart', toolId: 'cmd-1' }),
    );
    callbacks.onEvent({
      method: 'item/completed',
      params: { item: { id: 'cmd-1', type: 'commandExecution' } },
    });
    callbacks.onEvent({
      method: 'turn/completed',
      params: { turn: { status: 'failed', error: { message: 'Testes falharam' } } },
    });
    expect(task.status).toBe('failed');
    expect(task.error).toBe('Testes falharam');
    expect(office.snapshot().busy).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not answer approval until a human decides, and persists a single-use decision', async () => {
    const task = await office.launch('Editar');
    let answered = false;
    callbacks.onEvent({
      method: 'item/started',
      params: {
        item: {
          id: 'change-1',
          type: 'fileChange',
          changes: [{ path: 'a.js', diff: '+module.exports = 1;' }],
        },
      },
    });
    const response = callbacks.onApproval({
      id: 7,
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'change-1', reason: 'Editar arquivo' },
    });
    void response.then(() => {
      answered = true;
    });
    await Promise.resolve();
    expect(answered).toBe(false);
    expect(task.status).toBe('approval');
    const approval = office.snapshot().approvals[0];
    expect(office.decide(approval.id, 'accept')).toBe(true);
    expect(await response).toEqual({ decision: 'accept' });
    expect(office.decide(approval.id, 'accept')).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(directory, 'tasks.json'), 'utf8')).approvals[0].status,
    ).toBe('accepted');
  });

  it('expires unanswered requests and refuses additional permissions and unknown methods', async () => {
    await office.launch('Executar');
    expect(
      await callbacks.onApproval({ id: 8, method: 'item/commandExecution/requestApproval' }),
    ).toEqual({ decision: 'decline' });
    expect(office.snapshot().approvals[0].status).toBe('expired');
    expect(
      await callbacks.onApproval({
        id: 9,
        method: 'item/permissions/requestApproval',
        params: { permissions: { network: true } },
      }),
    ).toEqual({ permissions: {}, scope: 'turn' });
    await expect(callbacks.onApproval({ id: 10, method: 'unsupported/request' })).rejects.toThrow();
  });

  it('cancels pending permissions and never resurrects live agents from the ledger', async () => {
    const task = await office.launch('Executar');
    const approval = callbacks.onApproval({
      id: 1,
      method: 'item/commandExecution/requestApproval',
    });
    expect(office.cancel(task.id)).toBe(true);
    expect(await approval).toEqual({ decision: 'decline' });
    expect(task.status).toBe('interrupted');
    const restoredStore = new AgentStateStore();
    const restored = new Md2Office({
      store: restoredStore,
      cwd: directory,
      command: 'codex',
      ledger: path.join(directory, 'tasks.json'),
    });
    expect(restored.snapshot().tasks[0].status).toBe('interrupted');
    expect(restoredStore.size).toBe(0);
    expect(restored.snapshot().tasks[0].agentId).toBeUndefined();
    restored.dispose();
  });

  it('refuses parallel launches and records connection failures', async () => {
    const task = await office.launch('Executar');
    await expect(office.launch('Outra tarefa')).rejects.toThrow('já está');
    callbacks.onExit(new Error('Conexão perdida'));
    expect(task.status).toBe('failed');
    expect(task.error).toBe('Conexão perdida');
  });

  it('requires operator token, allowed host and same origin before launch or approval', async () => {
    const app = Fastify();
    registerMd2Routes(app, {
      token: 'operator-test',
      store,
      allowedHostnames: new Set(['localhost']),
      office,
    });
    const route = '/api/md2/tasks';
    const payload = { prompt: 'Executar' };
    expect((await app.inject({ method: 'POST', url: route, payload })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          payload,
          headers: { authorization: 'Bearer operator-test', host: 'evil.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          payload,
          headers: {
            authorization: 'Bearer operator-test',
            host: 'localhost',
            origin: 'https://evil.example',
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(office.snapshot().tasks).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: route,
          payload,
          headers: { authorization: 'Bearer operator-test', host: 'localhost' },
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/md2/approvals/unknown',
          payload: { decision: 'accept' },
          headers: { authorization: 'Bearer operator-test', host: 'localhost' },
        })
      ).statusCode,
    ).toBe(409);
    await app.close();
  });
  it('blocks approval when no file diff can be reviewed', async () => {
    await office.launch('Editar');
    const response = callbacks.onApproval({
      id: 1,
      method: 'item/fileChange/requestApproval',
      params: { itemId: 'missing-preview' },
    });
    const approval = office.snapshot().approvals[0];
    expect(office.decide(approval.id, 'accept')).toBe(false);
    expect(office.decide(approval.id, 'decline')).toBe(true);
    expect(await response).toEqual({ decision: 'decline' });
  });
});
