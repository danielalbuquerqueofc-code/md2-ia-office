import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

type RpcResult = {
  thread?: { id?: string };
  turn?: { id?: string };
  config?: { mcp_servers?: Record<string, unknown> };
};

export type RpcMessage = { id?: number | string; method: string; params?: Record<string, unknown> };

const STRIPPED_ENV = [
  'CODEX_APP_TOOLS_PIPE_PATH',
  'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'CODEX_THREAD_ID',
  'CODEX_SESSION_ID',
  'CODEX_TOOL_CALL_ID',
];

/**
 * Ends a process and all of its descendants. Windows: taskkill /T /F from System32 (never a
 * PATH lookup). POSIX: the child leads its own process group, so the whole group is signalled.
 */
export function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve();
  if (process.platform === 'win32') {
    const taskkill = path.join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'taskkill.exe',
    );
    return new Promise((resolve) =>
      execFile(
        taskkill,
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 10000 },
        () => resolve(),
      ),
    );
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  return Promise.resolve();
}

/** Private stdio transport. No HTTP token or server credentials are passed to Codex. */
export class CodexClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: RpcResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private exited: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      command: string;
      cwd: string;
      onEvent: (message: RpcMessage) => void;
      onApproval: (message: RpcMessage) => Promise<Record<string, unknown>>;
      onExit: (error: Error) => void;
      args?: string[];
      /** Per-request timeout (default 60 s). */
      requestTimeoutMs?: number;
      /** Extra environment for the child; values are never logged. */
      env?: Record<string, string>;
    },
  ) {}

  /** PID of the child, for the executor journal and tree termination. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    this.child = spawn(
      this.options.command,
      this.options.args ?? ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}'],
      {
        cwd: this.options.cwd,
        shell: false,
        windowsHide: true,
        // POSIX: own process group so the whole tree can be ended on close.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) => !STRIPPED_ENV.includes(name)),
          ),
          ...this.options.env,
        },
      },
    );
    const child = this.child;
    this.exited = new Promise((resolve) => child.once('exit', () => resolve()));
    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      void this.receive(line);
    });
    // Protocol data only comes from stdout; drain diagnostics without exposing credentials.
    child.stderr.resume();
    child.stdin.on('error', (error) => this.fail(error));
    child.on('error', (error) => this.fail(error));
    child.on('exit', (code) => {
      reader.close();
      if (!this.closed) this.fail(new Error(`Codex encerrou a conexão (${code}).`));
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<RpcResult> {
    if (this.closed) return Promise.reject(new Error('Conexão Codex encerrada.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tempo esgotado: ${method}`));
      }, this.options.requestTimeoutMs ?? 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string): void {
    this.write({ method });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(new Error('Conexão Codex encerrada.'));
    const child = this.child;
    const alive = () => !!child && child.exitCode === null && child.signalCode === null;
    if (alive())
      // Tree first: on Windows, taskkill /T needs the parent alive to find descendants.
      void killProcessTree(child!.pid).finally(() => {
        if (alive()) child!.kill();
      });
  }

  /** Closes and waits until the child (and, through the tree kill, its descendants) exited. */
  async terminate(timeoutMs = 10000): Promise<void> {
    this.close();
    if (!this.child) return;
    await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.close();
    this.options.onExit(error);
  }

  private write(message: unknown): void {
    if (!this.closed && this.child?.stdin.writable) {
      this.child.stdin.write(JSON.stringify(message) + '\n');
    }
  }

  private async receive(line: string): Promise<void> {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method) {
      if (message.id !== undefined) {
        try {
          const result = await this.options.onApproval(message);
          this.write({ id: message.id, result });
        } catch {
          this.write({
            id: message.id,
            error: { code: -32601, message: 'Pedido não autorizado pelo MD2.' },
          });
        }
      } else {
        this.options.onEvent(message);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error)
      pending.reject(new Error(String(message.error.message || 'Falha no Codex.')));
    else pending.resolve(message.result);
  }
}
