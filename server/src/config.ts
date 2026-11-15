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
  maxCostPerTask: number;
  maxRecoveries: number;
  authorizedDirs: string[];
  enablePlaywrightMcp: boolean;
  /** auto = usa o sandbox de SO do SDK quando suportado; required = recusa executar sem; off = desativado (não recomendado). */
  agentSandbox: 'auto' | 'required' | 'off';
  allowedHosts: string[];
  cookieSecure: boolean;
  backupDir: string;
  backupIntervalHours: number;
  backupKeep: number;
  logDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, rootDir = process.cwd()): Config {
  const host = env.MD2_HOST || '127.0.0.1';
  const adminPassword = env.MD2_ADMIN_PASSWORD || '';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const dataDir = path.resolve(rootDir, env.MD2_DATA_DIR || './data');
  const sandbox = (env.MD2_AGENT_SANDBOX || 'auto').toLowerCase();
  if (!['auto', 'required', 'off'].includes(sandbox)) throw new Error('MD2_AGENT_SANDBOX deve ser auto, required ou off.');
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
    dataDir,
    webDir: path.resolve(rootDir, 'dist/web'),
    modelAlfred: env.MD2_MODEL_ALFRED || undefined,
    modelAgents: env.MD2_MODEL_AGENTS || undefined,
    maxParallelTasks: num(env.MD2_MAX_PARALLEL_TASKS, 3),
    maxParallelExecutions: num(env.MD2_MAX_PARALLEL_EXECUTIONS, 2),
    taskTimeoutMs: num(env.MD2_TASK_TIMEOUT_MIN, 25) * 60_000,
    taskMaxTurns: num(env.MD2_TASK_MAX_TURNS, 60),
    taskMaxAttempts: num(env.MD2_TASK_MAX_ATTEMPTS, 2),
    maxCostPerExecution: num(env.MD2_MAX_COST_USD_PER_EXECUTION, 15),
    maxCostPerDay: num(env.MD2_MAX_COST_USD_PER_DAY, 60),
    authorizedDirs: (env.MD2_AUTHORIZED_DIRS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((p) => path.resolve(p)),
    enablePlaywrightMcp: env.MD2_ENABLE_PLAYWRIGHT_MCP === '1',
    maxCostPerTask: num(env.MD2_MAX_COST_USD_PER_TASK, 5),
    maxRecoveries: num(env.MD2_MAX_RECOVERIES, 2),
    agentSandbox: sandbox as Config['agentSandbox'],
    allowedHosts: (env.MD2_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    cookieSecure: env.MD2_COOKIE_SECURE === '1',
    backupDir: path.resolve(rootDir, env.MD2_BACKUP_DIR || './backups'),
    backupIntervalHours: num(env.MD2_BACKUP_INTERVAL_HOURS, 6),
    backupKeep: Math.max(2, num(env.MD2_BACKUP_KEEP, 14)),
    logDir: path.resolve(rootDir, env.MD2_LOG_DIR || path.join(env.MD2_DATA_DIR || './data', 'logs')),
  };
}
