import { createHash, randomUUID } from 'node:crypto';

import { MD2_AGENT_REGISTRY, type Md2BusinessAgent } from '../../../core/src/md2AgentRegistry.js';
import { redactMd2Text } from './sanitize.js';
import {
  appendSecurityEvent,
  enforce,
  readSecurityStore,
  requireTask,
  securityRecords,
  type SecurityStore,
} from './securityLedger.js';
import type { StorageScope, StorageSnapshot } from './storage.js';
import { validId } from './storageSchema.js';

type Capability = Md2BusinessAgent['capabilities'][number];
export type InternalActionKind = 'internal.analyze' | 'internal.draft' | 'local.execute';
export type ActionKind =
  | InternalActionKind
  | 'external.request'
  | 'publication.publish'
  | 'proposal.finalize'
  | 'commercial.commit'
  | 'money.spend'
  | 'data.delete';
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface PolicyAction {
  id: string;
  taskId: string;
  agentId: string;
  capability: Capability;
  kind: ActionKind;
  scope: StorageScope;
  resource: { scope: StorageScope; id: string };
  parameters: { [key: string]: Json };
}
export interface PolicyGrant {
  agentId: string;
  capability: Capability;
  kind: InternalActionKind;
  requireApproval: boolean;
}
export type PolicyDecision =
  | { decision: 'deny'; reason: string }
  | { decision: 'allow' | 'approval-required'; digest: string };
export interface AssignmentRequest {
  agentId: string;
  capability: Capability;
  kind: ActionKind;
  scope: StorageScope;
}
export type AssignmentAssessment =
  { eligibility: 'denied'; reason: string } | { eligibility: 'eligible' | 'approval-required' };
interface ApprovalRequest {
  requestId: string;
  taskId: string;
  actionId: string;
  agentId: string;
  digest: string;
  expiresAt: number;
  state: 'requested' | 'approved' | 'declined' | 'consumed';
  reviewerId?: string;
}

function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  enforce(
    !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === names.length &&
      names.every((key) => Object.hasOwn(value, key)),
    'INVALID_ACTION',
  );
}
function sameScope(a: StorageScope, b: StorageScope): boolean {
  return a.clientId === b.clientId && a.projectId === b.projectId;
}
function validateScope(scope: unknown): asserts scope is StorageScope {
  fields(scope, ['clientId', 'projectId']);
  enforce(validId(scope.clientId) && validId(scope.projectId), 'INVALID_SCOPE');
}
function canonical(value: unknown, depth = 0): string {
  enforce(depth <= 8, 'ACTION_TOO_DEEP');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    enforce(Number.isFinite(value), 'INVALID_ACTION');
    return JSON.stringify(value);
  }
  enforce(!!value && typeof value === 'object', 'INVALID_ACTION');
  if (Array.isArray(value)) {
    enforce(value.length <= 100 && Object.keys(value).length === value.length, 'INVALID_ACTION');
    return '[' + value.map((item) => canonical(item, depth + 1)).join(',') + ']';
  }
  enforce(
    Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    'INVALID_ACTION',
  );
  const keys = Object.keys(value).sort();
  enforce(
    keys.length <= 100 &&
      keys.every(
        (key) =>
          !['__proto__', 'prototype', 'constructor'].includes(key) &&
          Object.getOwnPropertyDescriptor(value, key)?.get === undefined,
      ),
    'INVALID_ACTION',
  );
  return (
    '{' +
    keys
      .map(
        (key) =>
          JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key], depth + 1),
      )
      .join(',') +
    '}'
  );
}
export function actionDigest(action: PolicyAction): string {
  fields(action, [
    'id',
    'taskId',
    'agentId',
    'capability',
    'kind',
    'scope',
    'resource',
    'parameters',
  ]);
  validateScope(action.scope);
  fields(action.resource, ['scope', 'id']);
  validateScope(action.resource.scope);
  enforce(
    validId(action.id) &&
      validId(action.taskId) &&
      validId(action.agentId) &&
      validId(action.resource.id) &&
      typeof action.kind === 'string' &&
      typeof action.capability === 'string',
    'INVALID_ACTION',
  );
  enforce(
    !!action.parameters &&
      typeof action.parameters === 'object' &&
      !Array.isArray(action.parameters),
    'INVALID_ACTION',
  );
  const encoded = canonical(action);
  enforce(Buffer.byteLength(encoded) <= 16000, 'ACTION_TOO_LARGE');
  // Hash the exact action; never approve a redacted substitute for a different action.
  enforce(redactMd2Text(encoded) === encoded, 'ACTION_CONTAINS_SENSITIVE_DATA');
  return createHash('sha256').update(encoded).digest('hex');
}

function approvals(snapshot: StorageSnapshot): Map<string, ApprovalRequest> {
  const result = new Map<string, ApprovalRequest>();
  const actions = new Set<string>();
  for (const record of securityRecords(snapshot, 'policy')) {
    enforce(
      validId(record.requestId) &&
        validId(record.taskId) &&
        validId(record.actionId) &&
        validId(record.agentId) &&
        typeof record.digest === 'string' &&
        /^[a-f0-9]{64}$/.test(record.digest) &&
        Number.isSafeInteger(record.expiresAt) &&
        (record.expiresAt as number) > 0,
      'INVALID_POLICY_LEDGER',
    );
    const value = record as unknown as ApprovalRequest;
    const prior = result.get(value.requestId);
    if (value.state === 'requested') {
      enforce(!prior && !actions.has(value.actionId), 'INVALID_POLICY_LEDGER');
      actions.add(value.actionId);
    } else {
      enforce(validId(value.reviewerId), 'INVALID_POLICY_LEDGER');
      enforce(
        prior &&
          prior.digest === value.digest &&
          prior.taskId === value.taskId &&
          prior.agentId === value.agentId &&
          prior.actionId === value.actionId &&
          prior.expiresAt === value.expiresAt,
        'INVALID_POLICY_LEDGER',
      );
      enforce(
        value.state === 'consumed'
          ? prior.state === 'approved'
          : ['approved', 'declined'].includes(value.state) && prior.state === 'requested',
        'INVALID_POLICY_LEDGER',
      );
    }
    result.set(value.requestId, {
      requestId: value.requestId,
      taskId: value.taskId,
      actionId: value.actionId,
      agentId: value.agentId,
      digest: value.digest,
      expiresAt: value.expiresAt,
      state: value.state,
      ...(value.reviewerId ? { reviewerId: value.reviewerId } : {}),
    });
  }
  return result;
}

/** Configuration and reviewer identity must come from a trusted host, never from agent input. */
export class Md2Policy {
  private readonly scope: StorageScope;
  private readonly grants: readonly PolicyGrant[];
  private readonly reviewers: ReadonlySet<string>;
  private lastNow = 0;
  constructor(
    private readonly store: SecurityStore,
    options: {
      scope: StorageScope;
      grants?: readonly PolicyGrant[];
      reviewerIds?: readonly string[];
    },
  ) {
    validateScope(options.scope);
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
    this.grants = structuredClone(options.grants ?? []);
    for (const grant of this.grants) {
      const agent = MD2_AGENT_REGISTRY.find((item) => item.id === grant.agentId);
      enforce(
        agent &&
          (agent.capabilities as readonly string[]).includes(grant.capability) &&
          ['internal.analyze', 'internal.draft', 'local.execute'].includes(grant.kind) &&
          typeof grant.requireApproval === 'boolean',
        'INVALID_GRANT',
      );
    }
    enforce((options.reviewerIds ?? []).every(validId), 'INVALID_REVIEWER');
    this.reviewers = new Set(options.reviewerIds ?? []);
  }
  private now(snapshot: StorageSnapshot): number {
    this.lastNow = Math.max(this.lastNow, Date.now(), Date.parse(snapshot.updatedAt));
    return this.lastNow;
  }
  private evaluateAt(action: PolicyAction, snapshot: StorageSnapshot): PolicyDecision {
    const digest = actionDigest(action);
    const denied = this.scopeOrCapabilityDenial(action, snapshot);
    if (denied) return { decision: 'deny', reason: denied };
    requireTask(snapshot, action.taskId, action.agentId);
    const decision = this.grantDecision(action);
    return decision.decision === 'deny' ? decision : { ...decision, digest };
  }
  private scopeOrCapabilityDenial(action: PolicyAction, snapshot: StorageSnapshot): string | null {
    if (
      !sameScope(action.scope, this.scope) ||
      !sameScope(action.resource.scope, this.scope) ||
      !sameScope(snapshot, this.scope)
    )
      return 'CROSS_SCOPE';
    const agent = MD2_AGENT_REGISTRY.find((item) => item.id === action.agentId);
    if (!agent || !(agent.capabilities as readonly string[]).includes(action.capability))
      return 'CAPABILITY_NOT_DECLARED';
    return null;
  }
  private grantDecision(
    action: PolicyAction,
  ): { decision: 'deny'; reason: string } | { decision: 'allow' | 'approval-required' } {
    if (!['internal.analyze', 'internal.draft', 'local.execute'].includes(action.kind))
      return { decision: 'deny', reason: 'ACTION_DENIED_BY_DEFAULT' };
    const grant = this.grants.find(
      (item) =>
        item.agentId === action.agentId &&
        item.capability === action.capability &&
        item.kind === action.kind,
    );
    if (!grant) return { decision: 'deny', reason: 'EXPLICIT_GRANT_REQUIRED' };
    return {
      decision:
        action.kind === 'local.execute' || grant.requireApproval ? 'approval-required' : 'allow',
    };
  }
  /** Eligibility only: no task, execution permission, approval or reservation is created. */
  async assessAssignment(request: AssignmentRequest): Promise<AssignmentAssessment> {
    const copied = structuredClone(request);
    const action: PolicyAction = {
      id: 'assignment-preflight',
      taskId: 'assignment-preflight',
      agentId: copied.agentId,
      capability: copied.capability,
      kind: copied.kind,
      scope: copied.scope,
      resource: { scope: copied.scope, id: 'assignment-preflight' },
      parameters: {},
    };
    actionDigest(action);
    const denied = this.scopeOrCapabilityDenial(action, await readSecurityStore(this.store));
    if (denied) return { eligibility: 'denied', reason: denied };
    const decision = this.grantDecision(action);
    return decision.decision === 'deny'
      ? { eligibility: 'denied', reason: decision.reason }
      : { eligibility: decision.decision === 'allow' ? 'eligible' : 'approval-required' };
  }
  async evaluate(action: PolicyAction): Promise<PolicyDecision> {
    return this.evaluateAt(action, await readSecurityStore(this.store));
  }
  requestApproval(action: PolicyAction, ttlMs = 120000): Promise<Readonly<ApprovalRequest>> {
    const copied = structuredClone(action);
    enforce(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= 86400000, 'INVALID_EXPIRATION');
    return appendSecurityEvent(this.store, 'policy', (snapshot) => {
      const decision = this.evaluateAt(copied, snapshot);
      enforce(decision.decision === 'approval-required', 'APPROVAL_NOT_PERMITTED');
      enforce(
        ![...approvals(snapshot).values()].some((item) => item.actionId === copied.id),
        'ACTION_ALREADY_REQUESTED',
      );
      const record: ApprovalRequest = {
        requestId: randomUUID(),
        actionId: copied.id,
        taskId: copied.taskId,
        agentId: copied.agentId,
        digest: decision.digest,
        expiresAt: this.now(snapshot) + ttlMs,
        state: 'requested',
      };
      return { taskId: copied.taskId, record, result: Object.freeze({ ...record }) };
    });
  }
  decide(
    requestId: string,
    action: PolicyAction,
    decision: 'approve' | 'decline',
    reviewerId: string,
  ): Promise<void> {
    const copied = structuredClone(action);
    enforce(
      this.reviewers.has(reviewerId) && ['approve', 'decline'].includes(decision),
      'REVIEWER_NOT_AUTHORIZED',
    );
    return appendSecurityEvent(this.store, 'policy', (snapshot) => {
      const evaluated = this.evaluateAt(copied, snapshot);
      enforce(evaluated.decision === 'approval-required', 'GRANT_REVOKED_OR_DENIED');
      const prior = approvals(snapshot).get(requestId);
      enforce(
        prior &&
          prior.state === 'requested' &&
          prior.digest === evaluated.digest &&
          this.now(snapshot) < prior.expiresAt,
        'APPROVAL_MISMATCH_EXPIRED_OR_USED',
      );
      return {
        taskId: copied.taskId,
        record: { ...prior, state: decision === 'approve' ? 'approved' : 'declined', reviewerId },
        result: undefined,
      };
    });
  }
  consume(requestId: string, action: PolicyAction): Promise<{ actionId: string; digest: string }> {
    const copied = structuredClone(action);
    return appendSecurityEvent(this.store, 'policy', (snapshot) => {
      const evaluated = this.evaluateAt(copied, snapshot);
      enforce(evaluated.decision === 'approval-required', 'GRANT_REVOKED_OR_DENIED');
      const prior = approvals(snapshot).get(requestId);
      enforce(
        prior &&
          prior.state === 'approved' &&
          prior.reviewerId &&
          this.reviewers.has(prior.reviewerId) &&
          prior.digest === evaluated.digest &&
          this.now(snapshot) < prior.expiresAt,
        'APPROVAL_MISMATCH_EXPIRED_OR_USED',
      );
      return {
        taskId: copied.taskId,
        record: { ...prior, state: 'consumed' },
        result: { actionId: copied.id, digest: evaluated.digest },
      };
    });
  }
}
