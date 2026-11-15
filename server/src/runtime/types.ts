export interface RuntimeStatus { ready: boolean; detail: string }

export interface AgentActivity {
  kind: 'texto' | 'ferramenta' | 'sessao';
  message: string;
  tool?: string;
  sessionId?: string;
}

/** Ferramentas internas da MD2 expostas ao agente (viram um servidor MCP em processo no runtime real). */
export interface AgentToolHandlers {
  registrarEntregavel(args: { caminho: string; nome: string; categoria: string; cliente?: string; observacoes?: string }): Promise<string>;
  solicitarAprovacao(args: { tipo: string; titulo: string; descricao: string; dados?: string }): Promise<string>;
  consultarConhecimento(args: { consulta: string }): Promise<string>;
}

export interface RunAgentOptions {
  system: string;
  prompt: string;
  cwd: string;
  sdkTools: string[];
  readDirs: string[];
  usePlaywright: boolean;
  handlers: AgentToolHandlers;
  maxTurns: number;
  maxBudgetUsd?: number;
  model?: string;
  resumeSessionId?: string;
  signal: AbortSignal;
  onActivity(a: AgentActivity): void;
}
export interface RunAgentResult { text: string; costUsd: number; sessionId?: string }

export interface RunStructuredOptions {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
  signal: AbortSignal;
}

/** Contrato do runtime de execução. Produção: ClaudeAgentRuntime. Testes: FakeRuntime (apenas em server/test). */
export interface AgentRuntime {
  status(): Promise<RuntimeStatus>;
  runStructured<T>(opts: RunStructuredOptions): Promise<{ data: T; costUsd: number }>;
  runAgent(opts: RunAgentOptions): Promise<RunAgentResult>;
}

export class RuntimeError extends Error {
  constructor(message: string, readonly retryable = true, readonly costUsd = 0) {
    super(message);
  }
}
