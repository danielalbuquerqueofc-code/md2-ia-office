import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCodexWorker } from '../src/md2/codexWorker.js';
import { validateWorkerResult, type WorkerInput } from '../src/md2/worker.js';

const FAKE = path.join(__dirname, 'fixtures', 'fakeCodexAppServer.cjs');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitDead(pid: number, ms = 5000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await sleep(50);
  }
  return !alive(pid);
}

describe('MD2 Codex worker against a simulated app-server process', () => {
  let root: string;
  let logFile: string;
  let sequence = 0;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-codex-'));
    logFile = path.join(root, 'fake.log');
  });
  afterEach(() => {
    delete process.env['FAKE_CODEX_MODE'];
    delete process.env['FAKE_CODEX_LOG'];
    fs.rmSync(root, { recursive: true, force: true });
  });

  function input(): WorkerInput {
    sequence += 1;
    return {
      workId: 'work-' + 'c'.repeat(40),
      leaseId: `lease-${sequence}`,
      attemptId: `attempt-${sequence}`,
      ownerId: 'owner-1',
      agentId: 'lucas',
      capability: 'leads.analyze',
      kind: 'internal.analyze',
      scope: { clientId: 'client-a', projectId: 'project-a' },
      content: { title: 'Avaliar oportunidade', description: 'Resumo fornecido pelo operador.' },
      allocation: { tokens: 100, costMicros: 100 },
      leaseExpiresAt: Date.now() + 60000,
      deadlineAt: Date.now() + 120000,
      authorization: { actionId: 'authorization-1' },
    };
  }
  function worker(mode: string, microsPerToken?: number) {
    process.env['FAKE_CODEX_MODE'] = mode;
    process.env['FAKE_CODEX_LOG'] = logFile;
    return createCodexWorker({
      command: process.execPath,
      args: [FAKE],
      workspaceRoot: path.join(root, 'workspaces'),
      requestTimeoutMs: 5000,
      microsPerToken,
    });
  }
  function entries(): Record<string, unknown>[] {
    return fs
      .readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  it('runs read-only in an isolated attempt directory and reports measured tokens', async () => {
    const job = input();
    const result = await worker('complete', 2).run(job, new AbortController().signal);
    expect(validateWorkerResult(result, job)).toEqual({
      workId: job.workId,
      leaseId: job.leaseId,
      attemptId: job.attemptId,
      outcome: 'completed',
      reason: 'COMPLETED',
      consumption: { tokens: 42, costMicros: 84 },
      output: 'Análise pronta.',
    });
    const log = entries();
    const cwd = log[0].cwd as string;
    expect(cwd.endsWith(path.join(job.attemptId))).toBe(true);
    expect(fs.realpathSync(cwd).startsWith(fs.realpathSync(path.join(root, 'workspaces')))).toBe(
      true,
    );
    const thread = log.find((entry) => entry.method === 'thread/start')!.params as Record<
      string,
      unknown
    >;
    expect(thread).toMatchObject({
      sandbox: 'read-only',
      approvalPolicy: 'never',
      config: { mcp_servers: { example: { enabled: false } } },
    });
    expect(await waitDead(log[0].pid as number)).toBe(true);
  });

  it('keeps cost unknown without an operator price and never reuses a directory', async () => {
    const job = input();
    const result = await worker('complete').run(job, new AbortController().signal);
    expect(result.consumption).toEqual({ tokens: 42, costMicros: null });
    const again = await worker('complete').run(job, new AbortController().signal);
    expect(again).toMatchObject({ outcome: 'not-started', reason: 'NOT_STARTED' });
  });

  it('declines every escalation request from the agent', async () => {
    const result = await worker('approval').run(input(), new AbortController().signal);
    expect(result.outcome).toBe('completed');
    const reply = entries().find(
      (entry) => entry.id === 'approval-1' && entry.method === undefined,
    );
    expect(reply?.result).toEqual({ decision: 'decline' });
  });

  it('maps failures and early exits without claiming success', async () => {
    expect((await worker('fail').run(input(), new AbortController().signal)).outcome).toBe(
      'failed',
    );
    expect(
      await worker('exit-before-turn').run(input(), new AbortController().signal),
    ).toMatchObject({ outcome: 'not-started', consumption: { tokens: 0, costMicros: 0 } });
    expect(
      await worker('exit-after-turn').run(input(), new AbortController().signal),
    ).toMatchObject({
      outcome: 'unknown',
      reason: 'PROCESS_EXITED',
      consumption: { tokens: null, costMicros: null },
    });
  });

  /** Waits (under load too) until the simulated server has received turn/start. */
  async function turnStarted(ms = 10000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (fs.existsSync(logFile) && entries().some((entry) => entry.method === 'turn/start'))
        return;
      await sleep(25);
    }
    throw new Error('simulated turn never started');
  }

  it('stops on timeout and terminates the process', async () => {
    const controller = new AbortController();
    const running = worker('hang').run(input(), controller.signal);
    await turnStarted();
    controller.abort('TIMEOUT');
    expect(await running).toMatchObject({ outcome: 'unknown', reason: 'TIMEOUT' });
    expect(await waitDead(entries()[0].pid as number)).toBe(true);
  });

  it('cancels and terminates the whole process tree, including grandchildren', async () => {
    const controller = new AbortController();
    const running = worker('hang-tree').run(input(), controller.signal);
    await turnStarted();
    const grandchild = entries().find((entry) => entry.grandchild)?.grandchild as number;
    expect(Number.isSafeInteger(grandchild)).toBe(true);
    expect(alive(grandchild)).toBe(true);
    controller.abort('CANCELLED_BY_OPERATOR');
    expect(await running).toMatchObject({ outcome: 'cancelled' });
    expect(await waitDead(entries()[0].pid as number)).toBe(true);
    expect(await waitDead(grandchild)).toBe(true);
  });

  it('does not start when already aborted', async () => {
    const controller = new AbortController();
    controller.abort('CANCELLED_BY_OPERATOR');
    expect(await worker('complete').run(input(), controller.signal)).toMatchObject({
      outcome: 'not-started',
    });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('refuses a workspace that is relative or inside the server checkout', () => {
    expect(() =>
      createCodexWorker({ command: 'codex', workspaceRoot: 'relative/workspaces' }),
    ).toThrow(expect.objectContaining({ code: 'CODEX_WORKSPACE_NOT_ABSOLUTE' }));
    expect(() =>
      createCodexWorker({ command: 'codex', workspaceRoot: path.join(process.cwd(), 'tmp-ws') }),
    ).toThrow(expect.objectContaining({ code: 'CODEX_WORKSPACE_INSIDE_CHECKOUT' }));
    expect(() =>
      createCodexWorker({ command: 'codex', workspaceRoot: path.parse(process.cwd()).root }),
    ).toThrow(expect.objectContaining({ code: 'CODEX_WORKSPACE_INSIDE_CHECKOUT' }));
  });
});
