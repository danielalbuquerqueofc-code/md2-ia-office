import path from 'node:path';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n > 0 ? n : d;
};

export interface Config {
  port: number;
  host: string;
  adminPassword: string;
  dataDir: string;
  rootDir: string;
  webDir: string;
  modelAlfred?: string;
  modelAgents?: string;
  maxParallelTasks: number;
  maxParallelExecutions: number;
  taskTimeoutMs: number;
  taskMaxTurns: number;
  taskMaxAttempts: number;
  maxCostPerExecution: number;
  maxCostPerDay: number;
  authorizedDirs: string[];
  enablePlaywrightMcp: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): Config {
  const host = env.MD2_HOST || '127.0.0.1';
  const adminPassword = env.MD2_ADMIN_PASSWORD || '';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!loopback && !adminPassword) {
    throw new Error(
      `MD2_HOST=${host} expõe o sistema na rede. Defina MD2_ADMIN_PASSWORD antes de iniciar (ou use MD2_HOST=127.0.0.1).`,
    );
  }
  return {
    port: num(env.MD2_PORT, 4310),
    host,
    adminPassword,
    rootDir,
    dataDir: path.resolve(rootDir, env.MD2_DATA_DIR || './data'),
    webDir: path.resolve(rootDir, 'dist/web'),
    modelAlfred: env.MD2_MODEL_ALFRED || undefined,
    modelAgents: env.MD2_MODEL_AGENTS || undefined,
    maxParallelTasks: num(env.MD2_MAX_PARALLEL_TASKS, 3),
    maxParallelExecutions: num(env.MD2_MAX_PARALLEL_EXECUTIONS, 2),
    taskTimeoutMs: num(env.MD2_TASK_TIMEOUT_MIN, 25) * 60_000,
    taskMaxTurns: num(env.MD2_TASK_MAX_TURNS, 60),
    taskMaxAttempts: num(env.MD2_TASK_MAX_ATTEMPTS, 2),
    maxCostPerExecution: num(env.MD2_MAX_COST_USD_PER_EXECUTION, 8),
    maxCostPerDay: num(env.MD2_MAX_COST_USD_PER_DAY, 40),
    authorizedDirs: (env.MD2_AUTHORIZED_DIRS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p)),
    enablePlaywrightMcp: env.MD2_ENABLE_PLAYWRIGHT_MCP === '1',
  };
}
