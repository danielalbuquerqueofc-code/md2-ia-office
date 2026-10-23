import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

type RpcResult = {
  thread?: { id?: string };
  turn?: { id?: string };
  config?: { mcp_servers?: Record<string, unknown> };
};

export type RpcMessage = { id?: number | string; method: string; params?: Record<string, unknown> };

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

  constructor(
    private readonly options: {
      command: string;
      cwd: string;
      onEvent: (message: RpcMessage) => void;
      onApproval: (message: RpcMessage) => Promise<Record<string, unknown>>;
      onExit: (error: Error) => void;
      args?: string[];
    },
  ) {}

  start(): void {
    this.child = spawn(
      this.options.command,
      this.options.args ?? ['app-server', '--listen', 'stdio://', '-c', 'mcp_servers={}'],
      {
        cwd: this.options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([name]) =>
              ![
                'CODEX_APP_TOOLS_PIPE_PATH',
                'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
                'CODEX_THREAD_ID',
                'CODEX_SESSION_ID',
                'CODEX_TOOL_CALL_ID',
              ].includes(name),
          ),
        ),
      },
    );
    const reader = createInterface({ input: this.child.stdout });
    reader.on('line', (line) => {
      void this.receive(line);
    });
    // Protocol data only comes from stdout; drain diagnostics without exposing credentials.
    this.child.stderr.resume();
    this.child.stdin.on('error', (error) => this.fail(error));
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => {
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
      }, 60000);
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
    this.child?.kill();
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
