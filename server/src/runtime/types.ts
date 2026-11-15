export interface RuntimeStatus { ready: boolean; detail: string; checkedAt?: string }

export interface AgentActivity {
  kind: 'texto' | 'ferramenta' | 'sessao' | 'bloqueio';
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
  /** Diretório de dados da plataforma: comandos do agente não podem lê-lo, exceto o próprio workspace. */
  dataDir: string;
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
export interface Usage { turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }
export interface RunAgentResult { text: string; costUsd: number; sessionId?: string; usage?: Usage }

export interface RunStructuredOptions {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  model?: string;
  maxBudgetUsd?: number;
  signal: AbortSignal;
}

/** Contrato do runtime de execução. Produção: ClaudeAgentRuntime. Testes: FakeRuntime (apenas em server/test). */
export interface AgentRuntime {
  /** Estado em cache; só faz chamada paga se nunca verificou, se `force` ou se a última verificação falhou há mais de 2 min. */
  status(force?: boolean): Promise<RuntimeStatus>;
  /** Último estado conhecido, sem nenhuma chamada (null se nunca verificado). */
  peek(): RuntimeStatus | null;
  /** Estado do isolamento de comandos dos agentes. */
  sandbox(): { active: boolean; mode: string; detail: string };
  runStructured<T>(opts: RunStructuredOptions): Promise<{ data: T; costUsd: number }>;
  runAgent(opts: RunAgentOptions): Promise<RunAgentResult>;
}

export class RuntimeError extends Error {
  constructor(message: string, readonly retryable = true, readonly costUsd = 0, readonly usage?: Usage) {
    super(message);
  }
}
