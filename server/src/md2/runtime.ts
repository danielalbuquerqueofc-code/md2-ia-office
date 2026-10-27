import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createCodexWorker } from './codexWorker.js';
import { Md2Director } from './director.js';
import { type ExecutionReport, Md2Executor, type Md2Worker } from './executor.js';
import type { LimitBand, LimitsConfiguration, Reservation } from './limits.js';
import { loadOperatorConfig, Md2OperatorAuth, type OperatorConfig } from './operatorAuth.js';
import { Md2Policy, type PolicyGrant } from './policy.js';
import { Md2Queue } from './queue.js';
import { enforce, Md2SecurityError } from './securityLedger.js';
import { Md2Storage, type StorageScope } from './storage.js';
import type { WorkerInput } from './worker.js';

/**
 * Composition root for the protected MD2 API (Phase 03C-06). Built only when
 * MD2_EXECUTOR_ENABLED=1; every missing or unsafe setting fails closed.
 */
export type Md2WorkerMode = 'disabled' | 'simulated' | 'codex';

export interface Md2RuntimeConfig {
  scope: StorageScope;
  /** Absolute storage root outside the checkout. */
  dataRoot: string;
  operators: OperatorConfig;
  worker: Md2WorkerMode | Md2Worker;
  /** Required for worker 'codex'. */
  codex?: { command: string; workspaceRoot: string; microsPerToken?: number };
  allocation: Reservation;
  limits: { task: LimitBand; agent: LimitBand; project: LimitBand };
  budget?: LimitsConfiguration['budget'];
  leaseMs?: number;
  maxRunMs?: number;
}

/** Execution grants: every pilot run needs a human approval bound to the exact action. */
export const PILOT_EXECUTION_GRANTS: readonly PolicyGrant[] = Object.freeze([
  {
    agentId: 'lucas',
    capability: 'leads.analyze',
    kind: 'internal.analyze',
    requireApproval: true,
  },
  {
    agentId: 'fernanda',
    capability: 'leads.analyze',
    kind: 'internal.analyze',
    requireApproval: true,
  },
  {
    agentId: 'rafael',
    capability: 'proposals.draft',
    kind: 'internal.draft',
    requireApproval: true,
  },
]);
/**
 * Intake only (director policy): Carlos may triage and the pilot agents may RECEIVE assignments.
 * It never authorizes execution — the queue uses PILOT_EXECUTION_GRANTS, which always require a
 * human approval bound to the exact action.
 */
const INTAKE_GRANTS: readonly PolicyGrant[] = Object.freeze([
  {
    agentId: 'carlos',
    capability: 'work.review',
    kind: 'internal.analyze',
    requireApproval: false,
  },
  ...PILOT_EXECUTION_GRANTS.map((grant) => ({ ...grant, requireApproval: false })),
]);

/** Deterministic local worker: no model, network, process or file access. */
export const simulatedWorker: Md2Worker = {
  async run(input: WorkerInput, signal: AbortSignal) {
    if (signal.aborted)
      return {
        workId: input.workId,
        leaseId: input.leaseId,
        attemptId: input.attemptId,
        outcome: 'not-started',
        reason: 'NOT_STARTED',
        consumption: { tokens: 0, costMicros: 0 },
        output: '',
      };
    return {
      workId: input.workId,
      leaseId: input.leaseId,
      attemptId: input.attemptId,
      outcome: 'completed',
      reason: 'COMPLETED',
      consumption: { tokens: 0, costMicros: 0 },
      output:
        `[Simulação local, sem IA] ${input.agentId} — ${input.content.title}\n` +
        'Rascunho de exemplo para validar o fluxo. Revise antes de qualquer uso.',
    };
  },
};

export interface Md2Runtime {
  scope: StorageScope;
  store: Md2Storage;
  auth: Md2OperatorAuth;
  policy: Md2Policy;
  director: Md2Director;
  queue: Md2Queue;
  executor: Md2Executor | null;
  workerMode: Md2WorkerMode | 'custom';
  /** Background run state for the HTTP layer. */
  run: {
    active: Promise<ExecutionReport | null> | null;
    last: ExecutionReport | null;
    lastError: string | null;
  };
}

function inside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function createMd2Runtime(config: Md2RuntimeConfig): Promise<Md2Runtime> {
  enforce(path.isAbsolute(config.dataRoot), 'RUNTIME_DATA_ROOT_NOT_ABSOLUTE');
  const checkout = process.cwd();
  enforce(
    !inside(path.resolve(config.dataRoot), checkout) &&
      !inside(checkout, path.resolve(config.dataRoot)),
    'RUNTIME_DATA_ROOT_INSIDE_CHECKOUT',
  );
  const scope = { clientId: config.scope.clientId, projectId: config.scope.projectId };
  fs.mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 });
  const store = new Md2Storage({ root: config.dataRoot, scope });
  if (!(await store.read())) await store.initialize();
  const auth = new Md2OperatorAuth(config.operators);
  const policy = new Md2Policy(store, {
    scope,
    grants: PILOT_EXECUTION_GRANTS,
    reviewerIds: auth.reviewerIds(),
  });
  const director = new Md2Director(store, {
    scope,
    policy: new Md2Policy(store, { scope, grants: INTAKE_GRANTS }),
    limits: config.limits,
    authenticate: auth.directorAuthenticator(),
  });
  const queue = new Md2Queue(store, {
    scope,
    director,
    policy,
    limits: { scope, ...config.limits, budget: config.budget },
    allocation: config.allocation,
    leaseMs: config.leaseMs,
    maxRunMs: config.maxRunMs,
  });
  let worker: Md2Worker | null = null;
  if (typeof config.worker === 'object') worker = config.worker;
  else if (config.worker === 'simulated') worker = simulatedWorker;
  else if (config.worker === 'codex') {
    enforce(config.codex, 'RUNTIME_CODEX_NOT_CONFIGURED');
    worker = createCodexWorker({
      command: config.codex.command,
      workspaceRoot: config.codex.workspaceRoot,
      microsPerToken: config.codex.microsPerToken,
      protectedRoots: [checkout, config.dataRoot],
    });
  }
  return {
    scope,
    store,
    auth,
    policy,
    director,
    queue,
    executor: worker ? new Md2Executor(store, { scope, queue, auth, worker }) : null,
    workerMode: typeof config.worker === 'object' ? 'custom' : config.worker,
    run: { active: null, last: null, lastError: null },
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  enforce(Number.isSafeInteger(parsed) && parsed >= 0, 'RUNTIME_INVALID_NUMBER');
  return parsed;
}

/**
 * Reads the protected API configuration from the environment. Returns null when the flag is off.
 * Throws (fail closed) when the flag is on but anything required is missing or unsafe.
 */
export function runtimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Md2RuntimeConfig | null {
  if (env['MD2_EXECUTOR_ENABLED'] !== '1') return null;
  const operatorsFile = env['MD2_OPERATORS_FILE'];
  const clientId = env['MD2_CLIENT_ID'];
  const projectId = env['MD2_PROJECT_ID'];
  if (!operatorsFile || !clientId || !projectId)
    throw new Md2SecurityError('RUNTIME_MISSING_CONFIGURATION');
  const worker = (env['MD2_WORKER'] ?? 'disabled') as Md2WorkerMode;
  enforce(['disabled', 'simulated', 'codex'].includes(worker), 'RUNTIME_INVALID_WORKER');
  const home = os.homedir();
  const taskTokens = positiveInt(env['MD2_TASK_MAX_TOKENS'], 20000);
  const taskCost = positiveInt(env['MD2_TASK_MAX_COST_MICROS'], 1);
  const budgetTokens = positiveInt(env['MD2_BUDGET_MAX_TOKENS'], 200000);
  const budgetCost = positiveInt(env['MD2_BUDGET_MAX_COST_MICROS'], 10);
  const band = (tokens: number, cost: number, attempts: number): LimitBand => ({
    maxAttempts: attempts,
    maxTokens: tokens,
    maxCostMicros: cost,
  });
  return {
    scope: { clientId, projectId },
    dataRoot: path.resolve(env['MD2_DATA_ROOT'] ?? path.join(home, '.pixel-agents', 'md2-data')),
    operators: loadOperatorConfig(path.resolve(operatorsFile)),
    worker,
    codex:
      worker === 'codex'
        ? {
            command:
              env['MD2_CODEX_COMMAND'] || (process.platform === 'win32' ? 'codex.exe' : 'codex'),
            workspaceRoot: path.resolve(
              env['MD2_WORKSPACE_ROOT'] ?? path.join(home, '.pixel-agents', 'md2-workspaces'),
            ),
            microsPerToken:
              env['MD2_MICROS_PER_TOKEN'] !== undefined
                ? Number(env['MD2_MICROS_PER_TOKEN'])
                : undefined,
          }
        : undefined,
    allocation: { tokens: Math.max(1, taskTokens), costMicros: Math.max(1, taskCost) },
    limits: {
      task: band(taskTokens, taskCost, 3),
      agent: band(budgetTokens, budgetCost, 50),
      project: band(budgetTokens, budgetCost, 100),
    },
    budget:
      budgetTokens > 0 && budgetCost > 0
        ? {
            id: 'md2-runtime-budget',
            scope: { clientId, projectId },
            currency: 'USD',
            maxTokens: budgetTokens,
            maxCostMicros: budgetCost,
            expiresAt: Date.now() + 30 * 86400000,
          }
        : undefined,
  };
}
