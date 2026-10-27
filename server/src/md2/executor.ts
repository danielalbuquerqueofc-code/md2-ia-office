import { randomUUID } from 'node:crypto';

import type { Consumption } from './limits.js';
import type { Md2OperatorAuth } from './operatorAuth.js';
import type { Md2Queue, QueueItem, QueueState } from './queue.js';
import { redactMd2Text } from './sanitize.js';
import { enforce, Md2SecurityError } from './securityLedger.js';
import type { Md2Storage, StorageScope } from './storage.js';
import {
  validateWorkerResult,
  type WorkerInput,
  workerInputFromReservation,
  type WorkerOutcome,
  type WorkerResult,
} from './worker.js';

/**
 * Phase 03C-04 executor. It drives ONE injected worker at a time through the queue's lease
 * protocol. It never starts a process, model, network call or agent by itself: the worker is
 * supplied by the trusted host (a simulated worker in this phase).
 */

/** The only contract a worker must honour: stop promptly when the signal aborts. */
export interface Md2Worker {
  run(input: WorkerInput, signal: AbortSignal): Promise<unknown>;
}

export type ExecutorStopReason = 'CANCELLED_BY_OPERATOR' | 'TIMEOUT' | 'LEASE_LOST';

export interface ExecutionReport {
  workId: string;
  leaseId: string;
  attemptId: string;
  /** Queue state after settlement (null when it could not be read back). */
  state: QueueState | null;
  /** What the worker reported, when a valid report arrived in time. */
  outcome: WorkerOutcome | null;
  stopReason: ExecutorStopReason | null;
  /** True when the queue recorded a final or retry state; false means reconciliation is needed. */
  settled: boolean;
}

export interface RecoveryReport {
  /** Items with no persisted start marker: proven not started and returned to the queue. */
  notStarted: string[];
  /** Items that may have started: they wait for an explicit operator reconciliation. */
  uncertain: { workId: string; leaseId: string; reported: WorkerOutcome | null }[];
  orphanAttemptIds: string[];
}

const ALLOWED_KINDS: readonly WorkerInput['kind'][] = ['internal.analyze', 'internal.draft'];
const JOURNAL_OUTPUT_MAX_CHARS = 12000;
const ZERO: Consumption = { tokens: 0, costMicros: 0 };

type JournalPhase = 'started' | 'result' | 'uncertain' | 'reconciled';
interface JournalEntry {
  namespace: 'md2.executor.v1';
  phase: JournalPhase;
  workId: string;
  leaseId: string;
  attemptId: string;
  [key: string]: unknown;
}

function code(error: unknown): string | undefined {
  return error instanceof Md2SecurityError ? error.code : undefined;
}

export class Md2Executor {
  private readonly scope: StorageScope;
  private busy = false;
  private active: { workId: string; abort: (reason: ExecutorStopReason) => void } | undefined;

  constructor(
    private readonly store: Md2Storage,
    private readonly options: {
      scope: StorageScope;
      queue: Md2Queue;
      auth: Md2OperatorAuth;
      worker: Md2Worker;
      /** Default: a third of the lease duration. */
      heartbeatMs?: number;
      /** The worker is stopped this long before deadlineAt so settlement fits in the lease. */
      settleMarginMs?: number;
      /** How long to wait for a stopped worker before treating its outcome as unknown. */
      abortGraceMs?: number;
    },
  ) {
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
    enforce(typeof options.worker?.run === 'function', 'EXECUTOR_WORKER_REQUIRED');
    for (const value of [options.heartbeatMs, options.settleMarginMs, options.abortGraceMs])
      enforce(
        value === undefined || (Number.isSafeInteger(value) && value > 0 && value <= 3600000),
        'EXECUTOR_INVALID_CONFIGURATION',
      );
  }

  /** Reserves and runs the next eligible item. Requires `queue.operate` on this exact scope. */
  async runNext(sessionToken: unknown): Promise<ExecutionReport | null> {
    const operator = this.options.auth.authorize(sessionToken, 'queue.operate', this.scope);
    enforce(!this.busy, 'EXECUTOR_BUSY');
    this.busy = true;
    try {
      await this.checkStore();
      const item = await this.options.queue.reserveNext();
      if (!item) return null;
      return await this.execute(item, operator.subjectId);
    } finally {
      this.busy = false;
      this.active = undefined;
    }
  }

  /** Stops the local run or cancels a queued/foreign item. Requires `queue.operate`. */
  async cancel(sessionToken: unknown, workId: string): Promise<'stopping' | QueueState> {
    this.options.auth.authorize(sessionToken, 'queue.operate', this.scope);
    if (this.active?.workId === workId) {
      this.active.abort('CANCELLED_BY_OPERATOR');
      return 'stopping';
    }
    return (await this.options.queue.cancel(workId)).state;
  }

  /**
   * After a restart: leases held by a previous owner or expired become reconciliation_required.
   * Only attempts without a persisted start marker are proven not started and re-queued.
   */
  async recover(sessionToken: unknown): Promise<RecoveryReport> {
    this.options.auth.authorize(sessionToken, 'queue.operate', this.scope);
    enforce(!this.busy, 'EXECUTOR_BUSY');
    await this.checkStore();
    const recovered = await this.options.queue.recover();
    const report: RecoveryReport = {
      notStarted: [],
      uncertain: [],
      orphanAttemptIds: recovered.orphanAttemptIds,
    };
    for (const workId of recovered.reconciliationRequired) {
      const item = await this.options.queue.peek(workId);
      if (!item || item.state !== 'reconciliation_required' || !item.lease) continue;
      const journal = await this.journal(workId, item.lease.attemptId);
      if (!journal.some((entry) => entry.phase === 'started')) {
        await this.options.queue.reconcile(workId, item.lease.id, 'not-started', ZERO);
        report.notStarted.push(workId);
        continue;
      }
      const result = journal.find((entry) => entry.phase === 'result');
      report.uncertain.push({
        workId,
        leaseId: item.lease.id,
        reported: (result?.outcome as WorkerOutcome | undefined) ?? null,
      });
    }
    return report;
  }

  /** Explicit operator decision for an uncertain item. Requires `queue.operate`. */
  async reconcile(
    sessionToken: unknown,
    workId: string,
    leaseId: string,
    outcome: 'not-started' | 'completed' | 'failed' | 'cancelled' | 'unknown',
    consumption: Consumption,
  ): Promise<QueueItem> {
    const operator = this.options.auth.authorize(sessionToken, 'queue.operate', this.scope);
    const item = await this.options.queue.reconcile(workId, leaseId, outcome, consumption);
    if (item.lease)
      await this.record(workId, {
        phase: 'reconciled',
        leaseId,
        attemptId: item.lease.attemptId,
        operatorId: operator.subjectId,
        outcome,
        consumption,
      }).catch(() => {});
    return item;
  }

  private async execute(item: QueueItem, operatorId: string): Promise<ExecutionReport> {
    const queue = this.options.queue;
    const lease = item.lease!;
    const base = { workId: item.id, leaseId: lease.id, attemptId: lease.attemptId };
    const notStarted = async (): Promise<ExecutionReport> => {
      await queue.release(item.id, lease.id, 'not-started').catch(() => {});
      return this.report(base, null, null);
    };

    // 1. Everything before the start marker is provably "not started".
    let input: WorkerInput;
    try {
      input = workerInputFromReservation(item, await queue.actionForReservation(item.id));
      enforce(ALLOWED_KINDS.includes(input.kind), 'EXECUTOR_KIND_NOT_ALLOWED');
      await queue.heartbeat(item.id, lease.id, lease.attemptId).catch((error) => {
        if (code(error) !== 'QUEUE_LEASE_DEADLINE_REACHED') throw error;
      });
      await this.record(item.id, { phase: 'started', ...base, operatorId });
    } catch {
      return notStarted();
    }

    // 2. Run with heartbeat, deadline and cancellation.
    const controller = new AbortController();
    let stopReason: ExecutorStopReason | null = null;
    const abort = (reason: ExecutorStopReason) => {
      if (stopReason) return;
      stopReason = reason;
      controller.abort(reason);
    };
    this.active = { workId: item.id, abort };
    let settling = false;
    let beating: Promise<void> | undefined;
    const heartbeatMs =
      this.options.heartbeatMs ?? Math.max(25, Math.floor((lease.expiresAt - lease.issuedAt) / 3));
    const ticker = setInterval(() => {
      if (settling || beating) return;
      beating = queue
        .heartbeat(item.id, lease.id, lease.attemptId)
        .then(() => {})
        .catch((error) => {
          // At the cap the lease simply runs until deadlineAt; the timeout handles it.
          if (code(error) !== 'QUEUE_LEASE_DEADLINE_REACHED') abort('LEASE_LOST');
        })
        .finally(() => {
          beating = undefined;
        });
    }, heartbeatMs);
    const deadline = input.deadlineAt;
    const margin =
      this.options.settleMarginMs ??
      Math.min(5000, Math.max(1, Math.floor((deadline - lease.issuedAt) / 10)));
    const timer = setTimeout(() => abort('TIMEOUT'), Math.max(0, deadline - margin - Date.now()));
    const grace = this.options.abortGraceMs ?? 5000;

    let raw: unknown;
    let returned = false;
    try {
      const work = Promise.resolve()
        .then(() => this.options.worker.run(structuredClone(input), controller.signal))
        .then(
          (value) => ({ value }),
          () => null,
        );
      const stopped = new Promise<null>((resolve) =>
        controller.signal.addEventListener('abort', () => setTimeout(() => resolve(null), grace), {
          once: true,
        }),
      );
      const settled = await Promise.race([work, stopped]);
      if (settled) {
        raw = settled.value;
        returned = true;
      }
    } finally {
      settling = true;
      clearInterval(ticker);
      clearTimeout(timer);
      await beating;
    }

    let result: WorkerResult | null = null;
    if (returned)
      try {
        result = validateWorkerResult(raw, input);
      } catch {
        result = null;
      }
    return this.settle(item, base, result, stopReason);
  }

  private async settle(
    item: QueueItem,
    base: { workId: string; leaseId: string; attemptId: string },
    result: WorkerResult | null,
    stopReason: ExecutorStopReason | null,
  ): Promise<ExecutionReport> {
    const queue = this.options.queue;
    const { leaseId } = base;
    const uncertain = async (reason: Parameters<Md2Queue['requireReconciliation']>[2]) => {
      await this.record(item.id, {
        phase: 'uncertain',
        ...base,
        stopReason,
        reported: result?.outcome ?? null,
        reason,
      }).catch(() => {});
      await queue.requireReconciliation(item.id, leaseId, reason).catch(() => {});
      return this.report(base, result, stopReason);
    };

    // A lost lease means another party may already act on this item: never settle here.
    if (stopReason === 'LEASE_LOST') {
      await this.record(item.id, {
        phase: 'uncertain',
        ...base,
        stopReason,
        reported: result?.outcome ?? null,
        reason: 'LEASE_LOST',
      }).catch(() => {});
      return this.report(base, result, stopReason);
    }
    if (!result) return uncertain(stopReason === 'TIMEOUT' ? 'TIMEOUT' : 'WORKER_NO_RESULT');

    // The result is journaled before the queue changes, as evidence for reconciliation.
    try {
      await this.record(item.id, {
        phase: 'result',
        ...base,
        outcome: result.outcome,
        reason: result.reason,
        consumption: result.consumption,
        output: result.output.slice(0, JOURNAL_OUTPUT_MAX_CHARS),
        truncated: result.output.length > JOURNAL_OUTPUT_MAX_CHARS,
      });
    } catch {
      return uncertain('RESULT_NOT_PERSISTED');
    }

    try {
      switch (result.outcome) {
        case 'completed':
          await queue.confirm(item.id, leaseId, result.consumption);
          break;
        case 'failed':
          await queue.fail(item.id, leaseId, result.consumption);
          break;
        case 'not-started':
          await queue.release(item.id, leaseId, 'not-started');
          break;
        case 'cancelled':
          if (stopReason !== 'CANCELLED_BY_OPERATOR') return uncertain('OUTCOME_UNKNOWN');
          await queue.cancel(item.id);
          await queue.reconcile(item.id, leaseId, 'cancelled', result.consumption);
          break;
        default:
          if (stopReason === 'CANCELLED_BY_OPERATOR') {
            await queue.cancel(item.id);
            return this.report(base, result, stopReason);
          }
          return uncertain(stopReason === 'TIMEOUT' ? 'TIMEOUT' : 'OUTCOME_UNKNOWN');
      }
    } catch {
      return uncertain('OUTCOME_UNKNOWN');
    }
    return this.report(base, result, stopReason);
  }

  private async report(
    base: { workId: string; leaseId: string; attemptId: string },
    result: WorkerResult | null,
    stopReason: ExecutorStopReason | null,
  ): Promise<ExecutionReport> {
    const item = await this.options.queue.peek(base.workId).catch(() => null);
    const state = item?.state ?? null;
    return {
      ...base,
      state,
      outcome: result?.outcome ?? null,
      stopReason,
      settled: state !== null && state !== 'reserved' && state !== 'reconciliation_required',
    };
  }

  private async checkStore(): Promise<void> {
    const snapshot = await this.store.read();
    enforce(
      snapshot &&
        snapshot.clientId === this.scope.clientId &&
        snapshot.projectId === this.scope.projectId,
      'EXECUTOR_SCOPE_MISMATCH',
    );
  }

  private async record(
    workId: string,
    entry: Omit<JournalEntry, 'namespace' | 'workId'>,
  ): Promise<void> {
    const message = JSON.stringify({ namespace: 'md2.executor.v1', workId, ...entry });
    enforce(redactMd2Text(message) === message, 'EXECUTOR_SENSITIVE_METADATA');
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.store.read();
      enforce(snapshot, 'EXECUTOR_SCOPE_MISMATCH');
      try {
        await this.store.commit(
          { events: [{ id: 'executor-' + randomUUID(), taskId: workId, type: 'note', message }] },
          snapshot.revision,
        );
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'CONFLICT') throw error;
      }
    }
    throw new Md2SecurityError('EXECUTOR_CONFLICT_RETRY_LIMIT');
  }

  private async journal(workId: string, attemptId: string): Promise<JournalEntry[]> {
    const snapshot = await this.store.read();
    const entries: JournalEntry[] = [];
    for (const event of snapshot?.data.events ?? []) {
      if (!event.id.startsWith('executor-') || event.taskId !== workId) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.message);
      } catch {
        parsed = null;
      }
      const entry = parsed as JournalEntry | null;
      if (entry?.namespace !== 'md2.executor.v1') {
        // Unreadable evidence is never proof of "not started".
        entries.push({
          namespace: 'md2.executor.v1',
          phase: 'started',
          workId,
          leaseId: '',
          attemptId,
        });
        continue;
      }
      if (entry.attemptId === attemptId) entries.push(entry);
    }
    return entries;
  }
}
