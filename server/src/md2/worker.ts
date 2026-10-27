import { isDeepStrictEqual } from 'node:util';

import type { Consumption, Reservation } from './limits.js';
import type { PolicyAction } from './policy.js';
import type { QueueItem } from './queue.js';
import { redactMd2Text } from './sanitize.js';
import { enforce } from './securityLedger.js';
import type { StorageScope } from './storage.js';
import { validId } from './storageSchema.js';

/**
 * Typed contract between the queue and a future executor (Phase 03C).
 * Types and validation only: nothing here starts a process, model or timer.
 */

/** Lifecycle of one attempt inside the executor. `started` is the point of no return. */
export type WorkerRunState = 'preparing' | 'started' | 'running' | 'settling' | 'settled';

export const WORKER_RUN_TRANSITIONS: Readonly<Record<WorkerRunState, readonly WorkerRunState[]>> =
  Object.freeze({
    // A run can only skip to `settled` before anything started (outcome not-started).
    preparing: ['started', 'settled'],
    started: ['running', 'settling'],
    running: ['settling'],
    settling: ['settled'],
    settled: [],
  });

export function canTransitionRun(from: WorkerRunState, to: WorkerRunState): boolean {
  return WORKER_RUN_TRANSITIONS[from]?.includes(to) ?? false;
}

export type WorkerOutcome = 'completed' | 'failed' | 'cancelled' | 'not-started' | 'unknown';

export type WorkerEndReason =
  | 'COMPLETED'
  | 'AGENT_FAILED'
  | 'PROCESS_EXITED'
  | 'TIMEOUT'
  | 'BUDGET_EXCEEDED'
  | 'CANCELLED_BY_OPERATOR'
  | 'LEASE_LOST'
  | 'LEASE_DEADLINE_REACHED'
  | 'NOT_STARTED'
  | 'OUTCOME_UNKNOWN';

/** Which end reasons are coherent with each outcome. */
export const WORKER_OUTCOME_REASONS: Readonly<Record<WorkerOutcome, readonly WorkerEndReason[]>> =
  Object.freeze({
    completed: ['COMPLETED'],
    failed: ['AGENT_FAILED', 'PROCESS_EXITED', 'TIMEOUT', 'BUDGET_EXCEEDED'],
    cancelled: ['CANCELLED_BY_OPERATOR'],
    'not-started': ['NOT_STARTED', 'LEASE_LOST', 'CANCELLED_BY_OPERATOR'],
    unknown: [
      'OUTCOME_UNKNOWN',
      'LEASE_LOST',
      'LEASE_DEADLINE_REACHED',
      'TIMEOUT',
      'PROCESS_EXITED',
      'CANCELLED_BY_OPERATOR',
    ],
  });

/** Measured consumption; `null` means unknown and is never replaced by an estimate. */
export type WorkerConsumption = Consumption;

export const WORKER_OUTPUT_MAX_CHARS = 50000;

export interface WorkerInput {
  workId: string;
  leaseId: string;
  attemptId: string;
  ownerId: string;
  agentId: string;
  capability: PolicyAction['capability'];
  kind: 'internal.analyze' | 'internal.draft';
  scope: StorageScope;
  content: { title: string; description: string };
  allocation: Reservation;
  leaseExpiresAt: number;
  /** Hard limit for the whole attempt. Heartbeats never extend past it. */
  deadlineAt: number;
  authorization: { actionId: string };
}

export interface WorkerResult {
  workId: string;
  leaseId: string;
  attemptId: string;
  outcome: WorkerOutcome;
  reason: WorkerEndReason;
  consumption: WorkerConsumption;
  output: string;
}

function measured(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

/** Builds the executor input from a freshly reserved queue item and its policy action. */
export function workerInputFromReservation(item: QueueItem, action: PolicyAction): WorkerInput {
  const lease = item.lease;
  enforce(
    item.state === 'reserved' &&
      lease !== null &&
      lease.deadlineAt !== undefined &&
      action.taskId === item.id &&
      action.agentId === item.agentId &&
      action.capability === item.capability &&
      action.kind === item.kind &&
      isDeepStrictEqual(action.scope, item.scope),
    'WORKER_INPUT_MISMATCH',
  );
  const parameters = action.parameters as Record<string, unknown>;
  enforce(
    typeof parameters?.title === 'string' &&
      typeof parameters.description === 'string' &&
      parameters.demandId === item.demandId,
    'WORKER_INPUT_MISMATCH',
  );
  return {
    workId: item.id,
    leaseId: lease.id,
    attemptId: lease.attemptId,
    ownerId: lease.ownerId,
    agentId: item.agentId,
    capability: item.capability,
    kind: item.kind,
    scope: { clientId: item.scope.clientId, projectId: item.scope.projectId },
    content: { title: parameters.title, description: parameters.description },
    allocation: { ...item.allocation },
    leaseExpiresAt: lease.expiresAt,
    deadlineAt: lease.deadlineAt,
    authorization: { actionId: action.id },
  };
}

/** Strict validation of what an executor reports back. Unknown keys are rejected. */
export function validateWorkerResult(value: unknown, input: WorkerInput): WorkerResult {
  enforce(
    !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 7,
    'WORKER_INVALID_RESULT',
  );
  const r = value as WorkerResult;
  enforce(
    r.workId === input.workId &&
      r.leaseId === input.leaseId &&
      r.attemptId === input.attemptId &&
      validId(r.leaseId) &&
      validId(r.attemptId),
    'WORKER_RESULT_MISMATCH',
  );
  enforce(
    Object.prototype.hasOwnProperty.call(WORKER_OUTCOME_REASONS, r.outcome) &&
      WORKER_OUTCOME_REASONS[r.outcome].includes(r.reason),
    'WORKER_INVALID_OUTCOME',
  );
  enforce(
    !!r.consumption &&
      typeof r.consumption === 'object' &&
      Object.keys(r.consumption).length === 2 &&
      measured(r.consumption.tokens) &&
      measured(r.consumption.costMicros),
    'WORKER_INVALID_CONSUMPTION',
  );
  if (r.outcome === 'not-started')
    enforce(
      r.consumption.tokens === 0 && r.consumption.costMicros === 0 && r.output === '',
      'WORKER_INVALID_NOT_STARTED',
    );
  enforce(
    typeof r.output === 'string' &&
      r.output.length <= WORKER_OUTPUT_MAX_CHARS &&
      redactMd2Text(r.output) === r.output,
    'WORKER_INVALID_OUTPUT',
  );
  return {
    workId: r.workId,
    leaseId: r.leaseId,
    attemptId: r.attemptId,
    outcome: r.outcome,
    reason: r.reason,
    consumption: { tokens: r.consumption.tokens, costMicros: r.consumption.costMicros },
    output: r.output,
  };
}
