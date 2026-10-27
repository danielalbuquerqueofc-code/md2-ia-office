import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { MD2_AGENT_REGISTRY } from '../../../core/src/md2AgentRegistry.js';
import type { DemandPriority, Md2Director } from './director.js';
import {
  type Consumption,
  type LimitsConfiguration,
  Md2Limits,
  type Reservation,
} from './limits.js';
import type { Md2Policy, PolicyAction, PolicyDecision } from './policy.js';
import { redactMd2Text } from './sanitize.js';
import { enforce, Md2SecurityError, readSecurityStore } from './securityLedger.js';
import {
  Md2Storage,
  Md2StorageError,
  type StorageChanges,
  type StorageScope,
  type StorageSnapshot,
} from './storage.js';
import { validId } from './storageSchema.js';

export type QueueState =
  | 'queued'
  | 'blocked'
  | 'reserved'
  | 'reconciliation_required'
  | 'completed'
  | 'failed'
  | 'cancelled';
export interface QueueLease {
  id: string;
  attemptId: string;
  ownerId: string;
  issuedAt: number;
  expiresAt: number;
}
interface QueueRecord {
  id: string;
  demandId: string;
  scope: StorageScope;
  agentId: string;
  capability: PolicyAction['capability'];
  kind: 'internal.analyze' | 'internal.draft';
  priority: DemandPriority;
  state: QueueState;
  attempts: number;
  maxAttempts: number;
  allocation: Reservation;
  approvalId: string | null;
  authorizationVersion: number;
  lease: QueueLease | null;
  lastConsumption: Consumption | null;
  reason: string | null;
}
export interface QueueItem extends QueueRecord {
  createdAt: string;
  updatedAt: string;
  history: { id: string; state: QueueState; attempts: number; createdAt: string }[];
}
const BOOT_ID = randomUUID();
let queueTail: Promise<unknown> = Promise.resolve();
const recoveryRoots = new Map<string, Md2Storage>();
const zero = { maxAttempts: 0, maxTokens: 0, maxCostMicros: 0 };
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = queueTail.catch(() => {}).then(operation);
  queueTail = next;
  return next;
}
function sameScope(a: StorageScope, b: StorageScope): boolean {
  return a.clientId === b.clientId && a.projectId === b.projectId;
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function actual(value: unknown): value is Consumption {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    (value.tokens === null || integer(value.tokens)) &&
    (value.costMicros === null || integer(value.costMicros))
  );
}
function allocation(value: unknown): value is Reservation {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    integer(value.tokens) &&
    value.tokens > 0 &&
    integer(value.costMicros) &&
    value.costMicros > 0
  );
}
function holding(item: QueueRecord): boolean {
  return item.state === 'reserved' || item.state === 'reconciliation_required';
}
function recordOf(item: QueueItem): QueueRecord {
  const { createdAt, updatedAt, history, ...record } = item;
  void createdAt;
  void updatedAt;
  void history;
  return record;
}
function event(record: QueueRecord): NonNullable<StorageChanges['events']>[number] {
  const message = JSON.stringify({ namespace: 'md2.queue.v1', ...record });
  enforce(redactMd2Text(message) === message, 'QUEUE_SENSITIVE_METADATA');
  return { id: 'queue-' + randomUUID(), taskId: record.id, type: 'status', message };
}
function immutable(record: QueueRecord): object {
  return {
    id: record.id,
    demandId: record.demandId,
    scope: record.scope,
    agentId: record.agentId,
    capability: record.capability,
    kind: record.kind,
    priority: record.priority,
    allocation: record.allocation,
    maxAttempts: record.maxAttempts,
  };
}
function project(snapshot: StorageSnapshot): QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const entry of snapshot.data.events.filter((entry) => entry.id.startsWith('queue-'))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.message);
    } catch {
      throw new Md2SecurityError('QUEUE_INVALID_LEDGER');
    }
    enforce(
      object(parsed) && parsed.namespace === 'md2.queue.v1' && Object.keys(parsed).length === 17,
      'QUEUE_INVALID_LEDGER',
    );
    const { namespace, ...fields } = parsed;
    void namespace;
    const r = fields as unknown as QueueRecord;
    enforce(
      validId(r.id) &&
        r.id === entry.taskId &&
        /^work-[a-f0-9]{40}$/.test(r.id) &&
        /^demand-[a-f0-9]{48}$/.test(r.demandId) &&
        object(r.scope) &&
        Object.keys(r.scope).length === 2 &&
        sameScope(r.scope, snapshot),
      'QUEUE_INVALID_LEDGER',
    );
    enforce(
      [
        'queued',
        'blocked',
        'reserved',
        'reconciliation_required',
        'completed',
        'failed',
        'cancelled',
      ].includes(r.state) &&
        ['low', 'normal', 'high'].includes(r.priority) &&
        ['internal.analyze', 'internal.draft'].includes(r.kind) &&
        integer(r.attempts) &&
        integer(r.maxAttempts) &&
        r.maxAttempts > 0 &&
        r.maxAttempts <= 100 &&
        r.attempts <= r.maxAttempts &&
        integer(r.authorizationVersion) &&
        r.authorizationVersion > 0 &&
        allocation(r.allocation),
      'QUEUE_INVALID_LEDGER',
    );
    enforce(
      (r.approvalId === null || validId(r.approvalId)) &&
        (r.lastConsumption === null || actual(r.lastConsumption)) &&
        (r.reason === null ||
          (typeof r.reason === 'string' && /^[A-Z0-9_]{1,120}$/.test(r.reason))),
      'QUEUE_INVALID_LEDGER',
    );
    enforce(
      MD2_AGENT_REGISTRY.some(
        (agent) =>
          agent.id === r.agentId &&
          (agent.capabilities as readonly string[]).includes(r.capability),
      ) &&
        snapshot.data.tasks.some((task) => task.id === r.id && task.agentId === r.agentId) &&
        snapshot.data.tasks.some((task) => task.id === r.demandId && task.agentId === 'carlos'),
      'QUEUE_INVALID_LEDGER',
    );
    if (r.lease !== null)
      enforce(
        object(r.lease) &&
          Object.keys(r.lease).length === 5 &&
          validId(r.lease.id) &&
          validId(r.lease.attemptId) &&
          validId(r.lease.ownerId) &&
          integer(r.lease.issuedAt) &&
          integer(r.lease.expiresAt) &&
          r.lease.expiresAt > r.lease.issuedAt &&
          r.attempts > 0,
        'QUEUE_INVALID_LEDGER',
      );
    enforce(!holding(r) || r.lease !== null, 'QUEUE_INVALID_LEDGER');
    enforce(!['queued', 'blocked'].includes(r.state) || r.lease === null, 'QUEUE_INVALID_LEDGER');
    const previous = items.get(r.id);
    if (!previous)
      enforce(
        ['queued', 'blocked'].includes(r.state) &&
          r.attempts === 0 &&
          r.authorizationVersion === 1 &&
          r.lease === null &&
          r.lastConsumption === null,
        'QUEUE_INVALID_LEDGER',
      );
    else {
      const transitions: Record<QueueState, readonly QueueState[]> = {
        queued: ['queued', 'blocked', 'reserved', 'cancelled', 'failed'],
        blocked: ['queued', 'blocked', 'reserved', 'cancelled', 'failed'],
        reserved: ['queued', 'completed', 'failed', 'cancelled', 'reconciliation_required'],
        reconciliation_required: [
          'queued',
          'completed',
          'failed',
          'cancelled',
          'reconciliation_required',
        ],
        completed: [],
        failed: [],
        cancelled: [],
      };
      enforce(
        isDeepStrictEqual(immutable(previous), immutable(r)) &&
          transitions[previous.state].includes(r.state) &&
          r.attempts === previous.attempts + (r.state === 'reserved' ? 1 : 0) &&
          r.authorizationVersion >= previous.authorizationVersion,
        'QUEUE_INVALID_LEDGER',
      );
      if (holding(previous) && r.lease)
        enforce(isDeepStrictEqual(r.lease, previous.lease), 'QUEUE_INVALID_LEDGER');
    }
    items.set(r.id, {
      ...r,
      createdAt: previous?.createdAt ?? entry.createdAt,
      updatedAt: entry.updatedAt,
      history: [
        ...(previous?.history ?? []),
        { id: entry.id, state: r.state, attempts: r.attempts, createdAt: entry.createdAt },
      ],
    });
  }
  return [...items.values()];
}
function reader(store: Md2Storage, scope: StorageScope): Md2Limits {
  return new Md2Limits(store, { scope, task: zero, agent: zero, project: zero });
}

/** Internal trusted-host API only. No process, model, external operation or timer is started. */
export class Md2Queue {
  private readonly scope: StorageScope;
  private readonly limits: Md2Limits;
  private readonly ownerId: string;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private readonly allocation: Reservation;
  constructor(
    private readonly store: Md2Storage,
    private readonly options: {
      scope: StorageScope;
      director: Md2Director;
      policy: Md2Policy;
      limits: LimitsConfiguration;
      allocation: Reservation;
      maxAttempts?: number;
      leaseMs?: number;
      ownerId?: string;
      recoveryRoots?: readonly Md2Storage[];
    },
  ) {
    enforce(
      validId(options.scope.clientId) &&
        validId(options.scope.projectId) &&
        sameScope(options.scope, options.limits.scope),
      'QUEUE_SCOPE_MISMATCH',
    );
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
    this.maxAttempts = options.maxAttempts ?? 3;
    this.leaseMs = options.leaseMs ?? 60000;
    this.ownerId = options.ownerId ?? BOOT_ID;
    enforce(
      integer(this.maxAttempts) &&
        this.maxAttempts > 0 &&
        this.maxAttempts <= 100 &&
        integer(this.leaseMs) &&
        this.leaseMs > 0 &&
        this.leaseMs <= 86400000 &&
        validId(this.ownerId) &&
        redactMd2Text(this.ownerId) === this.ownerId &&
        allocation(options.allocation),
      'QUEUE_INVALID_CONFIGURATION',
    );
    this.allocation = structuredClone(options.allocation);
    this.limits = new Md2Limits(store, options.limits);
    for (const root of [store, ...(options.recoveryRoots ?? [])]) {
      const key = path.dirname(path.dirname(root.file));
      recoveryRoots.set(process.platform === 'win32' ? key.toLowerCase() : key, root);
    }
  }
  private async snapshot(): Promise<StorageSnapshot> {
    const snapshot = await readSecurityStore(this.store);
    enforce(sameScope(snapshot, this.scope), 'QUEUE_SCOPE_MISMATCH');
    return snapshot;
  }
  private item(snapshot: StorageSnapshot, id: string): QueueItem {
    const item = project(snapshot).find((item) => item.id === id);
    enforce(item, 'QUEUE_ITEM_NOT_FOUND');
    return item;
  }
  private async change(
    id: string,
    update: (item: QueueItem) => QueueRecord | null,
    source = this.store,
  ): Promise<QueueItem> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await readSecurityStore(source);
      const prior = this.item(snapshot, id);
      const next = update(prior);
      if (!next) return prior;
      try {
        const saved = await source.commit({ events: [event(next)] }, snapshot.revision);
        return this.item(saved, id);
      } catch (error) {
        if (!(error instanceof Md2StorageError) || error.code !== 'CONFLICT') throw error;
      }
    }
    throw new Md2SecurityError('QUEUE_CONFLICT_RETRY_LIMIT');
  }
  enqueue(demandId: string, context: unknown): Promise<{ item: QueueItem; duplicate: boolean }> {
    return serial(async () => {
      const demand = await this.options.director.getForDistribution(demandId, context);
      enforce(
        sameScope(demand.scope, this.scope) &&
          demand.classification &&
          demand.responsibleAgentId === demand.classification.proposedAgentId,
        'QUEUE_DEMAND_NOT_ELIGIBLE',
      );
      const classification = demand.classification;
      const id =
        'work-' +
        createHash('sha256')
          .update(JSON.stringify([this.scope.clientId, this.scope.projectId, demand.id]))
          .digest('hex')
          .slice(0, 40);
      const kind = ['analyze', 'review', 'triage'].some((suffix) =>
        classification.capability.endsWith('.' + suffix),
      )
        ? 'internal.analyze'
        : 'internal.draft';
      const assessed = await this.options.policy.assessAssignment({
        agentId: classification.proposedAgentId,
        capability: classification.capability,
        kind,
        scope: this.scope,
      });
      for (let attempt = 0; attempt < 8; attempt++) {
        const snapshot = await this.snapshot();
        const existing = project(snapshot).find((item) => item.id === id);
        if (existing) return { item: existing, duplicate: true };
        enforce(
          snapshot.data.tasks.some((task) => task.id === demand.id && task.agentId === 'carlos') &&
            !snapshot.data.tasks.some((task) => task.id === id),
          'QUEUE_SOURCE_MISMATCH',
        );
        const record: QueueRecord = {
          id,
          demandId: demand.id,
          scope: this.scope,
          agentId: classification.proposedAgentId,
          capability: classification.capability,
          kind,
          priority: demand.priority,
          state: assessed.eligibility === 'eligible' ? 'queued' : 'blocked',
          attempts: 0,
          maxAttempts: this.maxAttempts,
          allocation: this.allocation,
          approvalId: null,
          authorizationVersion: 1,
          lease: null,
          lastConsumption: null,
          reason:
            assessed.eligibility === 'denied'
              ? 'POLICY_' + assessed.reason
              : assessed.eligibility === 'approval-required'
                ? 'APPROVAL_REQUIRED'
                : null,
        };
        try {
          const saved = await this.store.commit(
            {
              tasks: [
                {
                  id,
                  agentId: record.agentId,
                  status: 'created',
                  prompt: JSON.stringify({ title: demand.title, description: demand.description }),
                  output: '',
                },
              ],
              events: [event(record)],
            },
            snapshot.revision,
          );
          return { item: this.item(saved, id), duplicate: false };
        } catch (error) {
          if (!(error instanceof Md2StorageError) || error.code !== 'CONFLICT') throw error;
        }
      }
      throw new Md2SecurityError('QUEUE_CONFLICT_RETRY_LIMIT');
    });
  }
  async get(id: string, context: unknown): Promise<QueueItem | null> {
    const snapshot = await this.snapshot();
    const item = project(snapshot).find((item) => item.id === id);
    if (!item) return null;
    const demand = await this.options.director.get(item.demandId, context);
    enforce(
      demand && demand.id === item.demandId && sameScope(demand.scope, this.scope),
      'QUEUE_SOURCE_MISMATCH',
    );
    return structuredClone(item);
  }
  async actionForNextAttempt(id: string): Promise<PolicyAction> {
    const snapshot = await this.snapshot();
    return this.action(this.item(snapshot, id), snapshot);
  }
  private action(item: QueueItem, snapshot: StorageSnapshot): PolicyAction {
    const task = snapshot.data.tasks.find((task) => task.id === item.id)!;
    let content: unknown;
    try {
      content = JSON.parse(task.prompt);
    } catch {
      throw new Md2SecurityError('QUEUE_INVALID_CONTENT');
    }
    enforce(
      object(content) &&
        Object.keys(content).length === 2 &&
        typeof content.title === 'string' &&
        typeof content.description === 'string',
      'QUEUE_INVALID_CONTENT',
    );
    return {
      id:
        'authorization-' +
        createHash('sha256')
          .update(JSON.stringify([item.id, item.attempts + 1, item.authorizationVersion]))
          .digest('hex')
          .slice(0, 48),
      taskId: item.id,
      agentId: item.agentId,
      capability: item.capability,
      kind: item.kind,
      scope: this.scope,
      resource: { scope: this.scope, id: item.demandId },
      parameters: {
        demandId: item.demandId,
        title: content.title,
        description: content.description,
        priority: item.priority,
      },
    };
  }
  attachApproval(id: string, approvalId: string): Promise<QueueItem> {
    return serial(async () => {
      const snapshot = await this.snapshot();
      const item = this.item(snapshot, id);
      enforce(
        ['queued', 'blocked'].includes(item.state) && validId(approvalId),
        'QUEUE_CANNOT_ATTACH_APPROVAL',
      );
      const action = this.action(item, snapshot);
      enforce(
        (await this.options.policy.evaluate(action)).decision === 'approval-required',
        'QUEUE_APPROVAL_NOT_REQUIRED',
      );
      this.options.policy.planAuthorization(action, snapshot, approvalId);
      return this.change(id, (current) => {
        enforce(['queued', 'blocked'].includes(current.state), 'QUEUE_NOT_AVAILABLE');
        return current.approvalId === approvalId
          ? null
          : { ...recordOf(current), state: 'queued', reason: null, approvalId };
      });
    });
  }
  renewApproval(id: string): Promise<QueueItem> {
    return serial(() =>
      this.change(id, (item) => {
        enforce(['queued', 'blocked'].includes(item.state), 'QUEUE_NOT_AVAILABLE');
        return {
          ...recordOf(item),
          approvalId: null,
          authorizationVersion: item.authorizationVersion + 1,
          state: 'blocked',
          reason: 'APPROVAL_REQUIRED',
        };
      }),
    );
  }
  recover(): Promise<{
    held: boolean;
    reconciliationRequired: string[];
    orphanAttemptIds: string[];
  }> {
    return serial(() => this.recoverInternal());
  }
  private async recoverInternal(): Promise<{
    held: boolean;
    reconciliationRequired: string[];
    orphanAttemptIds: string[];
  }> {
    let held = false;
    const reconciliationRequired: string[] = [];
    const orphanAttemptIds: string[] = [];
    const stores = new Map<string, Md2Storage>();
    for (const root of recoveryRoots.values())
      for (const store of root.projectStoresForRecovery()) stores.set(store.file, store);
    for (const store of stores.values()) {
      let snapshot = await store.read();
      if (!snapshot) continue;
      const scope = { clientId: snapshot.clientId, projectId: snapshot.projectId };
      const limits = reader(store, scope);
      await limits.synchronize();
      for (const item of project(snapshot).filter(holding)) {
        held = true;
        if (
          item.state === 'reserved' &&
          (item.lease!.ownerId !== this.ownerId ||
            Math.max(Date.now(), Date.parse(snapshot.updatedAt)) >= item.lease!.expiresAt)
        ) {
          await this.change(
            item.id,
            (current) =>
              current.state !== 'reserved'
                ? null
                : {
                    ...recordOf(current),
                    state: 'reconciliation_required',
                    reason:
                      current.lease!.ownerId !== this.ownerId ? 'OWNER_RESTARTED' : 'LEASE_EXPIRED',
                  },
            store,
          );
          reconciliationRequired.push(item.id);
        } else if (item.state === 'reconciliation_required') reconciliationRequired.push(item.id);
      }
      snapshot = (await store.read())!;
      const queuedAttemptIds = project(snapshot)
        .filter(holding)
        .map((item) => item.lease!.attemptId);
      for (const id of (await limits.usage()).activeAttemptIds) {
        held = true;
        if (!queuedAttemptIds.includes(id)) orphanAttemptIds.push(id);
      }
    }
    return { held, reconciliationRequired, orphanAttemptIds };
  }
  reserveNext(): Promise<QueueItem | null> {
    return serial(async () => {
      if ((await this.recoverInternal()).held) return null;
      const rank = { high: 0, normal: 1, low: 2 };
      const candidates = project(await this.snapshot())
        .filter((item) => ['queued', 'blocked'].includes(item.state))
        .sort(
          (a, b) => rank[a.priority] - rank[b.priority] || a.createdAt.localeCompare(b.createdAt),
        );
      for (const candidate of candidates) {
        if (candidate.attempts >= Math.min(candidate.maxAttempts, this.maxAttempts)) {
          await this.change(candidate.id, (item) => ({
            ...recordOf(item),
            state: 'failed',
            reason: 'ATTEMPT_LIMIT_REACHED',
          }));
          continue;
        }
        const snapshot = await this.snapshot();
        const item = this.item(snapshot, candidate.id);
        const action = this.action(item, snapshot);
        let decision: PolicyDecision;
        try {
          decision = await this.options.policy.evaluate(action);
        } catch (error) {
          if (
            error instanceof Md2SecurityError &&
            ['ACTION_TOO_LARGE', 'ACTION_CONTAINS_SENSITIVE_DATA'].includes(error.code)
          ) {
            await this.block(item.id, 'POLICY_' + error.code);
            continue;
          }
          throw error;
        }
        if (
          decision.decision === 'deny' ||
          (decision.decision === 'approval-required' && !item.approvalId)
        ) {
          await this.block(
            item.id,
            decision.decision === 'deny' ? 'POLICY_' + decision.reason : 'APPROVAL_REQUIRED',
          );
          continue;
        }
        const leaseId = randomUUID();
        try {
          const reserved = await this.limits.reserve(
            item.id,
            item.agentId,
            item.allocation,
            (current, attemptId) => {
              const fresh = this.item(current, item.id);
              enforce(
                ['queued', 'blocked'].includes(fresh.state) &&
                  fresh.attempts < Math.min(fresh.maxAttempts, this.maxAttempts),
                'QUEUE_NOT_AVAILABLE',
              );
              const authorization = this.options.policy.planAuthorization(
                this.action(fresh, current),
                current,
                fresh.approvalId ?? undefined,
              );
              const now = Math.max(Date.now(), Date.parse(current.updatedAt));
              const next: QueueRecord = {
                ...recordOf(fresh),
                state: 'reserved',
                attempts: fresh.attempts + 1,
                lease: {
                  id: leaseId,
                  attemptId,
                  ownerId: this.ownerId,
                  issuedAt: now,
                  expiresAt: now + this.leaseMs,
                },
                reason: null,
                lastConsumption: null,
              };
              return { events: [...(authorization.events ?? []), event(next)] };
            },
          );
          const saved = this.item(await this.snapshot(), item.id);
          enforce(saved.lease?.attemptId === reserved.attemptId, 'QUEUE_RESERVATION_UNCERTAIN');
          return saved;
        } catch (error) {
          if (
            error instanceof Md2SecurityError &&
            ['GLOBAL_EXECUTOR_BUSY', 'UNRESOLVED_RESERVATION'].includes(error.code)
          )
            return null;
          if (
            error instanceof Md2SecurityError &&
            [
              'BUDGET_NOT_AUTHORIZED',
              'OPERATIONAL_LIMIT_REACHED',
              'AUTHORIZED_BUDGET_EXHAUSTED',
              'UNKNOWN_CONSUMPTION_REQUIRES_RECONCILIATION',
              'APPROVAL_REQUIRED',
              'APPROVAL_MISMATCH_EXPIRED_OR_USED',
            ].includes(error.code)
          ) {
            await this.block(item.id, error.code);
            continue;
          }
          throw error;
        }
      }
      return null;
    });
  }
  private block(id: string, reason: string): Promise<QueueItem> {
    return this.change(id, (item) =>
      item.state === 'blocked' && item.reason === reason
        ? null
        : { ...recordOf(item), state: 'blocked', reason },
    );
  }
  confirm(id: string, leaseId: string, consumption: Consumption): Promise<QueueItem> {
    return serial(() => this.finish(id, leaseId, 'completed', consumption, false));
  }
  fail(id: string, leaseId: string, consumption: Consumption): Promise<QueueItem> {
    return serial(() => this.finish(id, leaseId, 'failed', consumption, false));
  }
  release(id: string, leaseId: string, proof: 'not-started'): Promise<QueueItem> {
    enforce(proof === 'not-started', 'QUEUE_NOT_STARTED_ATTESTATION_REQUIRED');
    return serial(() => this.finish(id, leaseId, 'queued', { tokens: 0, costMicros: 0 }, false));
  }
  cancel(id: string): Promise<QueueItem> {
    return serial(() =>
      this.change(id, (item) => {
        if (item.state === 'cancelled') return null;
        enforce(!['completed', 'failed'].includes(item.state), 'QUEUE_ALREADY_FINISHED');
        return {
          ...recordOf(item),
          state: holding(item) ? 'reconciliation_required' : 'cancelled',
          reason: holding(item) ? 'CANCELLATION_REQUIRES_RECONCILIATION' : 'CANCELLED_BY_OPERATOR',
        };
      }),
    );
  }
  reconcile(
    id: string,
    leaseId: string,
    outcome: 'not-started' | 'completed' | 'failed' | 'cancelled' | 'unknown',
    consumption: Consumption,
  ): Promise<QueueItem> {
    enforce(
      ['not-started', 'completed', 'failed', 'cancelled', 'unknown'].includes(outcome) &&
        actual(consumption),
      'QUEUE_INVALID_RECONCILIATION',
    );
    return serial(async () => {
      await this.recoverInternal();
      const item = this.item(await this.snapshot(), id);
      enforce(
        item.state === 'reconciliation_required' && item.lease?.id === leaseId,
        'QUEUE_RECONCILIATION_REQUIRED',
      );
      if (outcome === 'unknown') return item;
      if (outcome === 'not-started')
        enforce(
          consumption.tokens === 0 && consumption.costMicros === 0,
          'QUEUE_INVALID_NOT_STARTED_MEASUREMENT',
        );
      return this.finish(
        id,
        leaseId,
        outcome === 'not-started' ? 'queued' : outcome,
        consumption,
        true,
      );
    });
  }
  private async finish(
    id: string,
    leaseId: string,
    outcome: 'queued' | 'completed' | 'failed' | 'cancelled',
    consumption: Consumption,
    recovery: boolean,
  ): Promise<QueueItem> {
    enforce(actual(consumption), 'QUEUE_INVALID_CONSUMPTION');
    const copied = structuredClone(consumption);
    const snapshot = await this.snapshot();
    const item = this.item(snapshot, id);
    if (['completed', 'failed', 'cancelled'].includes(item.state) && item.lease?.id === leaseId) {
      enforce(
        item.state === outcome && isDeepStrictEqual(item.lastConsumption, copied),
        'QUEUE_SETTLEMENT_CONFLICT',
      );
      await this.limits.synchronize();
      return item;
    }
    const validLease = (item: QueueItem, snapshot: StorageSnapshot) => {
      enforce(
        item.lease?.id === leaseId &&
          (recovery
            ? item.state === 'reconciliation_required'
            : item.state === 'reserved' &&
              item.lease.ownerId === this.ownerId &&
              Math.max(Date.now(), Date.parse(snapshot.updatedAt)) < item.lease.expiresAt),
        'QUEUE_LEASE_INVALID_OR_EXPIRED',
      );
    };
    validLease(item, snapshot);
    await this.limits.settle(item.lease!.attemptId, copied, (current) => {
      const fresh = this.item(current, id);
      validLease(fresh, current);
      const retry =
        outcome === 'queued' && fresh.attempts < Math.min(fresh.maxAttempts, this.maxAttempts);
      const next: QueueRecord = {
        ...recordOf(fresh),
        state: retry ? 'queued' : outcome === 'queued' ? 'failed' : outcome,
        reason: outcome === 'queued' && !retry ? 'ATTEMPT_LIMIT_REACHED' : null,
        approvalId: retry ? null : fresh.approvalId,
        authorizationVersion: fresh.authorizationVersion + (retry ? 1 : 0),
        lease: retry ? null : fresh.lease,
        lastConsumption: copied,
      };
      return { events: [event(next)] };
    });
    return this.item(await this.snapshot(), id);
  }
}
