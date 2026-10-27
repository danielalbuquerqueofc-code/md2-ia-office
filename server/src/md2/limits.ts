import { randomUUID } from 'node:crypto';

import {
  appendSecurityEvent,
  enforce,
  readSecurityStore,
  requireTask,
  securityRecords,
  type SecurityStore,
} from './securityLedger.js';
import type { StorageChanges, StorageScope, StorageSnapshot } from './storage.js';
import { validId } from './storageSchema.js';

export interface LimitBand {
  maxAttempts: number;
  maxTokens: number;
  maxCostMicros: number;
}
export interface AuthorizedBudget {
  id: string;
  scope: StorageScope;
  expiresAt: number;
  maxTokens: number;
  maxCostMicros: number;
  currency: 'USD';
}
export interface LimitsConfiguration {
  scope: StorageScope;
  task: LimitBand;
  agent: LimitBand;
  project: LimitBand;
  budget?: AuthorizedBudget;
  maxConcurrentExecutors?: 1;
}
export interface Consumption {
  tokens: number | null;
  costMicros: number | null;
}
export interface Reservation {
  tokens: number;
  costMicros: number;
}
interface Attempt {
  attemptId: string;
  taskId: string;
  agentId: string;
  budgetId: string;
  kind: 'reserved' | 'settled' | 'reconciled';
  reservation: Reservation;
  actual: Consumption;
}
export interface ConsumptionReport {
  attempts: number;
  knownTokens: number;
  knownCostMicros: number;
  unknownTokens: boolean;
  unknownCost: boolean;
  heldTokens: number;
  heldCostMicros: number;
  activeAttemptIds: string[];
}

// One gate for ALL instances, agents, projects and roots in this loaded process.
let tail: Promise<unknown> = Promise.resolve();
let active: { clientId: string; projectId: string; attemptId: string } | undefined;
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const next = tail.catch(() => {}).then(operation);
  tail = next;
  return next;
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function scopeMatches(a: StorageScope, b: StorageScope): boolean {
  return a.clientId === b.clientId && a.projectId === b.projectId;
}
function validReservation(value: unknown): value is Reservation {
  if (!value || typeof value !== 'object') return false;
  const r = value as Reservation;
  return (
    Object.keys(r).length === 2 &&
    integer(r.tokens) &&
    r.tokens > 0 &&
    integer(r.costMicros) &&
    r.costMicros > 0
  );
}
function validActual(value: unknown): value is Consumption {
  if (!value || typeof value !== 'object') return false;
  const actual = value as Consumption;
  return (
    Object.keys(actual).length === 2 &&
    (actual.tokens === null || integer(actual.tokens)) &&
    (actual.costMicros === null || integer(actual.costMicros))
  );
}
function attempts(snapshot: StorageSnapshot): Attempt[] {
  const records = new Map<string, Attempt>();
  for (const record of securityRecords(snapshot, 'limits')) {
    enforce(
      validId(record.attemptId) &&
        validId(record.taskId) &&
        validId(record.agentId) &&
        validId(record.budgetId) &&
        validReservation(record.reservation) &&
        validActual(record.actual),
      'INVALID_LIMITS_LEDGER',
    );
    const next = record as unknown as Attempt;
    const prior = records.get(next.attemptId);
    if (next.kind === 'reserved') {
      enforce(
        !prior && next.actual.tokens === null && next.actual.costMicros === null,
        'INVALID_LIMITS_LEDGER',
      );
    } else {
      enforce(
        prior &&
          next.taskId === prior.taskId &&
          next.agentId === prior.agentId &&
          next.budgetId === prior.budgetId &&
          next.reservation.tokens === prior.reservation.tokens &&
          next.reservation.costMicros === prior.reservation.costMicros,
        'INVALID_LIMITS_LEDGER',
      );
      enforce(
        next.kind === 'settled'
          ? prior.kind === 'reserved'
          : next.kind === 'reconciled' &&
              prior.kind === 'settled' &&
              (prior.actual.tokens === null || prior.actual.costMicros === null) &&
              next.actual.tokens !== null &&
              next.actual.costMicros !== null,
        'INVALID_LIMITS_LEDGER',
      );
      if (prior.actual.tokens !== null)
        enforce(next.actual.tokens === prior.actual.tokens, 'INVALID_LIMITS_LEDGER');
      if (prior.actual.costMicros !== null)
        enforce(next.actual.costMicros === prior.actual.costMicros, 'INVALID_LIMITS_LEDGER');
    }
    records.set(next.attemptId, {
      attemptId: next.attemptId,
      taskId: next.taskId,
      agentId: next.agentId,
      budgetId: next.budgetId,
      kind: next.kind,
      reservation: { ...next.reservation },
      actual: { ...next.actual },
    });
  }
  return [...records.values()];
}
function report(records: Attempt[]): ConsumptionReport {
  const result: ConsumptionReport = {
    attempts: records.length,
    knownTokens: 0,
    knownCostMicros: 0,
    unknownTokens: false,
    unknownCost: false,
    heldTokens: 0,
    heldCostMicros: 0,
    activeAttemptIds: [],
  };
  for (const attempt of records) {
    if (attempt.kind === 'reserved') result.activeAttemptIds.push(attempt.attemptId);
    if (attempt.actual.tokens === null) {
      result.unknownTokens = true;
      result.heldTokens += attempt.reservation.tokens;
    } else result.knownTokens += attempt.actual.tokens;
    if (attempt.actual.costMicros === null) {
      result.unknownCost = true;
      result.heldCostMicros += attempt.reservation.costMicros;
    } else result.knownCostMicros += attempt.actual.costMicros;
  }
  enforce(
    [result.knownTokens, result.knownCostMicros, result.heldTokens, result.heldCostMicros].every(
      integer,
    ),
    'CONSUMPTION_OVERFLOW',
  );
  return result;
}

/** Records reservations only; it never starts a process or schedules work. Trusted host API. */
export class Md2Limits {
  private readonly config: LimitsConfiguration;
  constructor(
    private readonly store: SecurityStore,
    config: LimitsConfiguration,
  ) {
    enforce(validId(config.scope.clientId) && validId(config.scope.projectId), 'INVALID_SCOPE');
    enforce(
      config.maxConcurrentExecutors === undefined || config.maxConcurrentExecutors === 1,
      'GLOBAL_CONCURRENCY_MUST_BE_ONE',
    );
    for (const band of [config.task, config.agent, config.project])
      enforce(
        band &&
          Object.keys(band).length === 3 &&
          [band.maxAttempts, band.maxTokens, band.maxCostMicros].every(integer),
        'INVALID_LIMITS',
      );
    if (config.budget)
      enforce(
        validId(config.budget.id) &&
          scopeMatches(config.scope, config.budget.scope) &&
          config.budget.currency === 'USD' &&
          integer(config.budget.maxTokens) &&
          integer(config.budget.maxCostMicros) &&
          integer(config.budget.expiresAt),
        'INVALID_BUDGET',
      );
    this.config = structuredClone(config);
  }
  private checkScope(snapshot: StorageSnapshot): void {
    enforce(scopeMatches(snapshot, this.config.scope), 'CROSS_SCOPE');
  }
  async usage(filter?: { taskId?: string; agentId?: string }): Promise<ConsumptionReport> {
    const snapshot = await readSecurityStore(this.store);
    this.checkScope(snapshot);
    return report(
      attempts(snapshot).filter(
        (attempt) =>
          (!filter?.taskId || attempt.taskId === filter.taskId) &&
          (!filter?.agentId || attempt.agentId === filter.agentId),
      ),
    );
  }
  reserve(
    taskId: string,
    agentId: string,
    reservation: Reservation,
    transaction?: (snapshot: StorageSnapshot, attemptId: string) => StorageChanges,
  ): Promise<{ attemptId: string }> {
    const copied = structuredClone(reservation);
    enforce(validReservation(copied), 'INVALID_RESERVATION');
    return exclusive(async () => {
      enforce(!active, 'GLOBAL_EXECUTOR_BUSY');
      const attemptId = randomUUID();
      const result = await appendSecurityEvent(this.store, 'limits', (snapshot) => {
        this.checkScope(snapshot);
        requireTask(snapshot, taskId, agentId);
        const budget = this.config.budget;
        enforce(
          budget && Math.max(Date.now(), Date.parse(snapshot.updatedAt)) < budget.expiresAt,
          'BUDGET_NOT_AUTHORIZED',
        );
        const history = attempts(snapshot);
        enforce(!history.some((attempt) => attempt.kind === 'reserved'), 'UNRESOLVED_RESERVATION');
        enforce(
          !history.some(
            (attempt) =>
              attempt.kind !== 'reserved' &&
              (attempt.actual.tokens === null || attempt.actual.costMicros === null),
          ),
          'UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION',
        );
        for (const [records, band] of [
          [history.filter((item) => item.taskId === taskId), this.config.task],
          [history.filter((item) => item.agentId === agentId), this.config.agent],
          [history, this.config.project],
        ] as const) {
          const usage = report([...records]);
          enforce(
            usage.attempts < band.maxAttempts &&
              usage.knownTokens + usage.heldTokens + copied.tokens <= band.maxTokens &&
              usage.knownCostMicros + usage.heldCostMicros + copied.costMicros <=
                band.maxCostMicros,
            'OPERATIONAL_LIMIT_REACHED',
          );
        }
        const usage = report(history);
        enforce(
          usage.knownTokens + usage.heldTokens + copied.tokens <= budget.maxTokens &&
            usage.knownCostMicros + usage.heldCostMicros + copied.costMicros <=
              budget.maxCostMicros,
          'AUTHORIZED_BUDGET_EXHAUSTED',
        );
        return {
          taskId,
          changes: transaction?.(snapshot, attemptId),
          record: {
            attemptId,
            taskId,
            agentId,
            budgetId: budget.id,
            kind: 'reserved',
            reservation: copied,
            actual: { tokens: null, costMicros: null },
          },
          result: { attemptId },
        };
      });
      active = { ...this.config.scope, attemptId };
      return result;
    });
  }
  settle(
    attemptId: string,
    actual: Consumption,
    transaction?: (snapshot: StorageSnapshot) => StorageChanges,
  ): Promise<void> {
    return this.recordActual(attemptId, actual, false, transaction);
  }
  reconcile(attemptId: string, actual: { tokens: number; costMicros: number }): Promise<void> {
    return this.recordActual(attemptId, actual, true);
  }
  /** Clear only a slot whose durable settlement was already confirmed (e.g. lost acknowledgement). */
  synchronize(): Promise<void> {
    return exclusive(async () => {
      const snapshot = await readSecurityStore(this.store);
      this.checkScope(snapshot);
      if (active && scopeMatches(active, this.config.scope)) {
        const record = attempts(snapshot).find(
          (attempt) => attempt.attemptId === active?.attemptId,
        );
        // Another registered root may use the same client/project IDs. Absence
        // is never proof of settlement and must not clear its global slot.
        if (record && record.kind !== 'reserved') active = undefined;
      }
    });
  }
  private recordActual(
    attemptId: string,
    actual: Consumption,
    reconcile: boolean,
    transaction?: (snapshot: StorageSnapshot) => StorageChanges,
  ): Promise<void> {
    const copied = structuredClone(actual);
    enforce(
      validId(attemptId) &&
        validActual(copied) &&
        (!reconcile || (copied.tokens !== null && copied.costMicros !== null)),
      'INVALID_CONSUMPTION',
    );
    return exclusive(async () => {
      await appendSecurityEvent(this.store, 'limits', (snapshot) => {
        this.checkScope(snapshot);
        const prior = attempts(snapshot).find((attempt) => attempt.attemptId === attemptId);
        enforce(
          prior &&
            (reconcile
              ? prior.kind === 'settled' &&
                (prior.actual.tokens === null || prior.actual.costMicros === null)
              : prior.kind === 'reserved'),
          'ATTEMPT_ALREADY_SETTLED_OR_UNKNOWN',
        );
        enforce(
          prior.actual.tokens === null || prior.actual.tokens === copied.tokens,
          'KNOWN_CONSUMPTION_IMMUTABLE',
        );
        enforce(
          prior.actual.costMicros === null || prior.actual.costMicros === copied.costMicros,
          'KNOWN_CONSUMPTION_IMMUTABLE',
        );
        // Real overspend is recorded honestly, even if it exceeds the original reservation.
        return {
          taskId: prior.taskId,
          changes: transaction?.(snapshot),
          record: { ...prior, kind: reconcile ? 'reconciled' : 'settled', actual: copied },
          result: undefined,
        };
      });
      if (active?.attemptId === attemptId && scopeMatches(active, this.config.scope))
        active = undefined;
    });
  }
}
