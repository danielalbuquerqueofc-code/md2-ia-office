import { createHash } from 'node:crypto';

import { MD2_AGENT_REGISTRY, type Md2BusinessAgent } from '../../../core/src/md2AgentRegistry.js';
import { type LimitsConfiguration, Md2Limits } from './limits.js';
import type { ActionKind, AssignmentAssessment, Md2Policy } from './policy.js';
import { redactMd2Text } from './sanitize.js';
import { enforce, readSecurityStore, type SecurityStore } from './securityLedger.js';
import type { StorageScope, StorageSnapshot } from './storage.js';
import { Md2StorageError, validId } from './storageSchema.js';

type Capability = Md2BusinessAgent['capabilities'][number];
// These are suggestions for supplied information, never dispatch instructions.
const RULES = [
  ['strategy.plan', 'carlos', 'strategy.plan', 'internal.draft', ['estrategia', 'prioridades']],
  [
    'commercial.prospect',
    'lucas',
    'leads.analyze',
    'internal.analyze',
    ['prospeccao', 'prospectar'],
  ],
  [
    'commercial.qualify',
    'fernanda',
    'leads.analyze',
    'internal.analyze',
    ['qualificacao', 'qualificar'],
  ],
  ['commercial.proposal', 'rafael', 'proposals.draft', 'internal.draft', ['proposta', 'propostas']],
  ['marketing.strategy', 'mariana', 'campaigns.plan', 'internal.draft', ['campanha', 'campanhas']],
  ['marketing.brand', 'beatriz', 'campaigns.plan', 'internal.draft', ['marca', 'branding']],
  [
    'marketing.performance',
    'gabriel',
    'marketing.analyze',
    'internal.analyze',
    ['metricas', 'desempenho de marketing'],
  ],
  ['marketing.media', 'pedro', 'campaigns.plan', 'internal.draft', ['midia', 'plano de anuncios']],
  ['technology.code', 'andre', 'code.draft', 'internal.draft', ['codigo', 'site', 'programacao']],
  [
    'technology.architecture',
    'camila',
    'software.design',
    'internal.draft',
    ['arquitetura', 'arquitetura de software'],
  ],
  [
    'technology.automation',
    'diego',
    'software.design',
    'internal.draft',
    ['automacao', 'automatizar'],
  ],
  [
    'technology.quality',
    'sofia',
    'tests.plan',
    'internal.draft',
    ['testes', 'qualidade de software'],
  ],
  ['support.triage', 'juliana', 'support.triage', 'internal.analyze', ['suporte', 'triagem']],
  [
    'support.relationship',
    'bruno',
    'replies.draft',
    'internal.draft',
    ['retencao', 'relacionamento'],
  ],
  [
    'finance.analysis',
    'renata',
    'finance.analyze',
    'internal.analyze',
    ['financeiro', 'analise financeira'],
  ],
  [
    'finance.report',
    'eduardo',
    'finance.reports.draft',
    'internal.draft',
    ['relatorio financeiro', 'controle financeiro'],
  ],
  [
    'operations.plan',
    'thiago',
    'projects.plan',
    'internal.draft',
    ['cronograma', 'planejamento de projeto'],
  ],
  [
    'operations.review',
    'amanda',
    'deliveries.review',
    'internal.analyze',
    ['entregas', 'revisao de entrega'],
  ],
  ['production.draft', 'isabela', 'content.draft', 'internal.draft', ['redacao', 'artigo']],
  [
    'production.review',
    'vinicius',
    'content.review',
    'internal.analyze',
    ['revisao de conteudo', 'revisao editorial'],
  ],
  [
    'legal.review',
    'helena',
    'legal.review',
    'internal.analyze',
    ['juridico', 'juridica', 'contrato'],
  ],
  [
    'administration.organize',
    'patricia',
    'records.organize',
    'internal.draft',
    ['administrativo', 'documentos administrativos'],
  ],
] as const satisfies readonly (readonly [
  string,
  string,
  Capability,
  ActionKind,
  readonly string[],
])[];
export type DemandIntent = (typeof RULES)[number][0];
export type DemandPriority = 'low' | 'normal' | 'high';
export type DemandStatus =
  'received' | 'classified' | 'needs_clarification' | 'blocked' | 'approval_required';
export interface DirectorDemandInput {
  requestId: string;
  scope: StorageScope;
  title: string;
  description: string;
  intent?: DemandIntent;
  urgency?: DemandPriority;
  requestedAction?: ActionKind;
}
export interface AuthenticatedDirectorPrincipal {
  subjectId: string;
  role: 'ceo';
  scopes: readonly StorageScope[];
  permissions: readonly ('director.submit' | 'director.read')[];
  expiresAt: number;
}
/** Supplied by the trusted host's authentication adapter, never by the demand body. */
export type DirectorAuthenticator = (
  context: unknown,
) => Promise<AuthenticatedDirectorPrincipal | null>;
interface Classification {
  intent: DemandIntent;
  departmentId: Md2BusinessAgent['departmentId'];
  capability: Capability;
  proposedAgentId: string;
}
export interface DirectorDemand {
  id: string;
  scope: StorageScope;
  submittedBy: string;
  title: string;
  description: string;
  status: DemandStatus;
  priority: DemandPriority;
  ownerId: 'carlos';
  responsibleAgentId: string;
  classification: Classification | null;
  reason: string;
  redacted: boolean;
  hasUnknownConsumption: boolean;
  executionAllowed: false;
  createdAt: string;
  updatedAt: string;
  history: { id: string; status: DemandStatus; createdAt: string }[];
}
interface NormalizedInput {
  requestId: string;
  scope: StorageScope;
  title: string;
  description: string;
  intent: DemandIntent | null;
  urgency: DemandPriority;
  requestedAction: ActionKind | null;
}
interface ReceivedRecord {
  namespace: 'md2.director.v1';
  stage: 'received';
  demandId: string;
  subjectId: string;
  requestDigest: string;
}
interface ClassifiedRecord {
  namespace: 'md2.director.v1';
  stage: 'classified';
  demandId: string;
  status: Exclude<DemandStatus, 'received'>;
  priority: DemandPriority;
  classification: Classification | null;
  responsibleAgentId: string;
  reason: string;
  redacted: boolean;
  hasUnknownConsumption: boolean;
}
const statuses = ['classified', 'needs_clarification', 'blocked', 'approval_required'];
const actionKinds: readonly string[] = [
  'internal.analyze',
  'internal.draft',
  'local.execute',
  'external.request',
  'publication.publish',
  'proposal.finalize',
  'commercial.commit',
  'money.spend',
  'data.delete',
];
function sameScope(a: StorageScope, b: StorageScope): boolean {
  return a.clientId === b.clientId && a.projectId === b.projectId;
}
function object(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => !descriptor.get && !descriptor.set,
    )
  );
}
function validateScope(scope: unknown): asserts scope is StorageScope {
  enforce(
    object(scope) &&
      Object.keys(scope).length === 2 &&
      validId(scope.clientId) &&
      validId(scope.projectId),
    'DIRECTOR_INVALID_SCOPE',
  );
}
function normalize(value: string): string {
  return (
    ' ' +
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim() +
    ' '
  );
}
function contains(text: string, words: readonly string[]): boolean {
  return words.some((word) => text.includes(' ' + word + ' '));
}
function validateInput(body: unknown): { input: NormalizedInput; redacted: boolean } {
  enforce(
    object(body) &&
      Object.keys(body).every((key) =>
        [
          'requestId',
          'scope',
          'title',
          'description',
          'intent',
          'urgency',
          'requestedAction',
        ].includes(key),
      ),
    'DIRECTOR_INVALID_INPUT',
  );
  enforce(
    validId(body.requestId) && redactMd2Text(body.requestId) === body.requestId,
    'DIRECTOR_INVALID_REQUEST_ID',
  );
  validateScope(body.scope);
  enforce(
    typeof body.title === 'string' &&
      body.title.trim().length > 0 &&
      body.title.length <= 160 &&
      typeof body.description === 'string' &&
      body.description.trim().length > 0 &&
      body.description.length <= 8000,
    'DIRECTOR_INVALID_TEXT',
  );
  enforce(
    body.intent === undefined || RULES.some(([intent]) => intent === body.intent),
    'DIRECTOR_INVALID_INTENT',
  );
  enforce(
    body.urgency === undefined ||
      (typeof body.urgency === 'string' && ['low', 'normal', 'high'].includes(body.urgency)),
    'DIRECTOR_INVALID_PRIORITY',
  );
  enforce(
    body.requestedAction === undefined ||
      (typeof body.requestedAction === 'string' && actionKinds.includes(body.requestedAction)),
    'DIRECTOR_INVALID_ACTION',
  );
  const title = redactMd2Text(body.title.trim());
  const description = redactMd2Text(body.description.trim());
  enforce(title.trim() && description.trim(), 'DIRECTOR_INVALID_TEXT');
  return {
    input: {
      requestId: body.requestId,
      scope: { clientId: body.scope.clientId, projectId: body.scope.projectId },
      title,
      description,
      intent: (body.intent as DemandIntent | undefined) ?? null,
      urgency: (body.urgency as DemandPriority | undefined) ?? 'normal',
      requestedAction: (body.requestedAction as ActionKind | undefined) ?? null,
    },
    redacted: title !== body.title.trim() || description !== body.description.trim(),
  };
}
function priority(input: NormalizedInput): DemandPriority {
  return input.urgency === 'high' ||
    contains(normalize(input.title + ' ' + input.description), [
      'urgente',
      'critico',
      'critica',
      'prazo hoje',
    ])
    ? 'high'
    : input.urgency;
}

/** Receiving/classification only. No route, account, executor, reservation or dispatch is installed. */
export class Md2Director {
  private readonly scope: StorageScope;
  private readonly limits: Md2Limits;
  constructor(
    private readonly store: SecurityStore,
    private readonly options: {
      scope: StorageScope;
      authenticate: DirectorAuthenticator;
      policy: Md2Policy;
      limits: Pick<LimitsConfiguration, 'task' | 'agent' | 'project'>;
    },
  ) {
    validateScope(options.scope);
    enforce(typeof options.authenticate === 'function', 'DIRECTOR_AUTHENTICATOR_REQUIRED');
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
    this.limits = new Md2Limits(store, {
      task: options.limits.task,
      agent: options.limits.agent,
      project: options.limits.project,
      scope: this.scope,
      maxConcurrentExecutors: 1,
    });
    for (const [, agentId, capability] of RULES)
      enforce(
        MD2_AGENT_REGISTRY.some(
          (agent) =>
            agent.id === agentId && (agent.capabilities as readonly string[]).includes(capability),
        ),
        'DIRECTOR_INVALID_RULE',
      );
  }
  private async principal(
    context: unknown,
    permission: 'director.submit' | 'director.read',
  ): Promise<AuthenticatedDirectorPrincipal> {
    let principal: AuthenticatedDirectorPrincipal | null;
    try {
      principal = await this.options.authenticate(context);
    } catch {
      throw new Error('DIRECTOR_AUTHENTICATION_FAILED');
    }
    enforce(
      principal &&
        principal.role === 'ceo' &&
        validId(principal.subjectId) &&
        redactMd2Text(principal.subjectId) === principal.subjectId &&
        Number.isSafeInteger(principal.expiresAt) &&
        Date.now() < principal.expiresAt &&
        Array.isArray(principal.permissions) &&
        principal.permissions.includes(permission) &&
        Array.isArray(principal.scopes),
      'DIRECTOR_NOT_AUTHORIZED',
    );
    for (const scope of principal.scopes) validateScope(scope);
    enforce(
      principal.scopes.some((scope) => sameScope(scope, this.scope)),
      'DIRECTOR_SCOPE_NOT_AUTHORIZED',
    );
    return structuredClone(principal);
  }
  private async snapshot(): Promise<StorageSnapshot> {
    const snapshot = await readSecurityStore(this.store);
    enforce(sameScope(snapshot, this.scope), 'DIRECTOR_STORAGE_SCOPE_MISMATCH');
    return snapshot;
  }
  private async classify(
    input: NormalizedInput,
    redacted: boolean,
    id: string,
  ): Promise<ClassifiedRecord> {
    const text = normalize(input.title + ' ' + input.description);
    const matches = input.intent
      ? RULES.filter(([intent]) => intent === input.intent)
      : RULES.filter((rule) => contains(text, rule[4]));
    const selected = matches.length === 1 ? matches[0] : null;
    const agent = selected ? MD2_AGENT_REGISTRY.find((agent) => agent.id === selected[1])! : null;
    const classification: Classification | null =
      selected && agent
        ? {
            intent: selected[0],
            proposedAgentId: agent.id,
            departmentId: agent.departmentId,
            capability: selected[2],
          }
        : null;
    const usage = await this.limits.usage(); // Read only: no budget is allocated or spent for local rules.
    const base = {
      namespace: 'md2.director.v1' as const,
      stage: 'classified' as const,
      demandId: id,
      priority: priority(input),
      classification,
      responsibleAgentId: 'carlos',
      redacted,
      hasUnknownConsumption: usage.unknownTokens || usage.unknownCost,
    };
    const carlos = await this.options.policy.assessAssignment({
      agentId: 'carlos',
      capability: 'work.review',
      kind: 'internal.analyze',
      scope: this.scope,
    });
    if (carlos.eligibility !== 'eligible')
      return {
        ...base,
        status: carlos.eligibility === 'denied' ? 'blocked' : 'approval_required',
        reason:
          carlos.eligibility === 'denied' ? 'CARLOS_' + carlos.reason : 'CARLOS_APPROVAL_REQUIRED',
      };
    if (
      (input.requestedAction &&
        !['internal.analyze', 'internal.draft'].includes(input.requestedAction)) ||
      contains(text, [
        'enviar',
        'publique',
        'publicar',
        'comprar',
        'pagar',
        'excluir',
        'deletar',
        'assinar',
        'fechar contrato',
      ])
    )
      return { ...base, status: 'blocked', reason: 'SENSITIVE_OR_EXECUTABLE_ACTION_NOT_SUPPORTED' };
    if (redacted)
      return { ...base, status: 'needs_clarification', reason: 'SENSITIVE_INPUT_REDACTED' };
    if (!selected || !classification)
      return {
        ...base,
        status: 'needs_clarification',
        reason: matches.length > 1 ? 'MULTIPLE_INTENTS' : 'NO_MATCHING_INTENT',
      };
    if (input.requestedAction && input.requestedAction !== selected[3])
      return { ...base, status: 'needs_clarification', reason: 'INTENT_ACTION_MISMATCH' };
    const assessed: AssignmentAssessment = await this.options.policy.assessAssignment({
      agentId: classification.proposedAgentId,
      capability: classification.capability,
      kind: selected[3],
      scope: this.scope,
    });
    if (assessed.eligibility !== 'eligible')
      return {
        ...base,
        status: assessed.eligibility === 'denied' ? 'blocked' : 'approval_required',
        reason: assessed.eligibility === 'denied' ? assessed.reason : 'ASSIGNEE_APPROVAL_REQUIRED',
      };
    return {
      ...base,
      responsibleAgentId: classification.proposedAgentId,
      status: 'classified',
      reason: input.intent ? 'EXPLICIT_INTENT' : 'DETERMINISTIC_KEYWORD_MATCH',
    };
  }
  async receive(
    body: unknown,
    context: unknown,
  ): Promise<{ demand: DirectorDemand; duplicate: boolean }> {
    const { input, redacted } = validateInput(body);
    const principal = await this.principal(context, 'director.submit');
    enforce(sameScope(input.scope, this.scope), 'DIRECTOR_SCOPE_NOT_AUTHORIZED');
    const hash = createHash('sha256')
      .update(
        JSON.stringify([
          this.scope.clientId,
          this.scope.projectId,
          principal.subjectId,
          input.requestId,
        ]),
      )
      .digest('hex')
      .slice(0, 48);
    const id = 'demand-' + hash;
    const requestDigest = createHash('sha256')
      .update(JSON.stringify({ ...input, redacted }))
      .digest('hex');
    const prompt = JSON.stringify({ title: input.title, description: input.description });
    enforce(redactMd2Text(prompt) === prompt, 'DIRECTOR_SENSITIVE_INPUT');
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.snapshot();
      enforce(
        Date.now() < principal.expiresAt && Date.parse(snapshot.updatedAt) < principal.expiresAt,
        'DIRECTOR_NOT_AUTHORIZED',
      );
      const existing = this.view(snapshot, id, principal.subjectId, requestDigest);
      if (existing) return { demand: existing, duplicate: true };
      const classified = await this.classify(input, redacted, id);
      enforce(Date.now() < principal.expiresAt, 'DIRECTOR_NOT_AUTHORIZED');
      const received: ReceivedRecord = {
        namespace: 'md2.director.v1',
        stage: 'received',
        demandId: id,
        subjectId: principal.subjectId,
        requestDigest,
      };
      try {
        const saved = await this.store.commit(
          {
            tasks: [{ id, agentId: 'carlos', status: 'created', prompt, output: '' }],
            events: [
              {
                id: `director-${hash}-received`,
                taskId: id,
                type: 'status',
                message: JSON.stringify(received),
              },
              {
                id: `director-${hash}-classified`,
                taskId: id,
                type: 'status',
                message: JSON.stringify(classified),
              },
            ],
          },
          snapshot.revision,
        );
        return {
          demand: this.view(saved, id, principal.subjectId, requestDigest)!,
          duplicate: false,
        };
      } catch (error) {
        if (!(error instanceof Md2StorageError) || error.code !== 'CONFLICT') throw error;
      }
    }
    throw new Error('DIRECTOR_CONFLICT_RETRY_LIMIT');
  }
  async get(id: string, context: unknown): Promise<DirectorDemand | null> {
    return this.getAuthorized(id, context, 'director.read');
  }
  /** Distribution requires submit permission; a read-only CEO session cannot enqueue work. */
  async getForDistribution(id: string, context: unknown): Promise<DirectorDemand> {
    const demand = await this.getAuthorized(id, context, 'director.submit');
    enforce(
      demand && demand.status === 'classified' && demand.classification,
      'DIRECTOR_DEMAND_NOT_ELIGIBLE',
    );
    return demand;
  }
  private async getAuthorized(
    id: string,
    context: unknown,
    permission: 'director.read' | 'director.submit',
  ): Promise<DirectorDemand | null> {
    enforce(typeof id === 'string' && /^demand-[a-f0-9]{48}$/.test(id), 'DIRECTOR_INVALID_ID');
    const principal = await this.principal(context, permission);
    const snapshot = await this.snapshot();
    enforce(
      Date.parse(snapshot.updatedAt) < principal.expiresAt && Date.now() < principal.expiresAt,
      'DIRECTOR_NOT_AUTHORIZED',
    );
    return this.view(snapshot, id, principal.subjectId);
  }
  private view(
    snapshot: StorageSnapshot,
    id: string,
    subjectId: string,
    requestDigest?: string,
  ): DirectorDemand | null {
    const task = snapshot.data.tasks.find((task) => task.id === id);
    if (!task) return null;
    const events = snapshot.data.events.filter(
      (event) => event.taskId === id && event.id.startsWith('director-'),
    );
    enforce(task.agentId === 'carlos' && events.length === 2, 'DIRECTOR_INVALID_LEDGER');
    let received: ReceivedRecord;
    let classified: ClassifiedRecord;
    let content: { title: string; description: string };
    try {
      received = JSON.parse(events[0].message);
      classified = JSON.parse(events[1].message);
      content = JSON.parse(task.prompt);
    } catch {
      throw new Error('DIRECTOR_INVALID_LEDGER');
    }
    enforce(
      object(received) &&
        Object.keys(received).length === 5 &&
        object(classified) &&
        Object.keys(classified).length === 10 &&
        object(content) &&
        Object.keys(content).length === 2 &&
        events[0].id === `director-${id.slice(7)}-received` &&
        events[1].id === `director-${id.slice(7)}-classified`,
      'DIRECTOR_INVALID_LEDGER',
    );
    enforce(
      received?.namespace === 'md2.director.v1' &&
        received.stage === 'received' &&
        received.demandId === id &&
        validId(received.subjectId) &&
        typeof received.requestDigest === 'string' &&
        /^[a-f0-9]{64}$/.test(received.requestDigest) &&
        classified?.namespace === 'md2.director.v1' &&
        classified.stage === 'classified' &&
        classified.demandId === id &&
        statuses.includes(classified.status) &&
        ['low', 'normal', 'high'].includes(classified.priority) &&
        typeof classified.redacted === 'boolean' &&
        typeof classified.hasUnknownConsumption === 'boolean' &&
        typeof classified.reason === 'string' &&
        content &&
        typeof content.title === 'string' &&
        typeof content.description === 'string',
      'DIRECTOR_INVALID_LEDGER',
    );
    enforce(received.subjectId === subjectId, 'DIRECTOR_NOT_AUTHORIZED');
    enforce(
      requestDigest === undefined || requestDigest === received.requestDigest,
      'DIRECTOR_IDEMPOTENCY_CONFLICT',
    );
    if (classified.classification !== null)
      enforce(
        object(classified.classification) &&
          Object.keys(classified.classification).length === 4 &&
          RULES.some(
            ([intent, agentId, capability]) =>
              intent === classified.classification?.intent &&
              agentId === classified.classification.proposedAgentId &&
              capability === classified.classification.capability &&
              MD2_AGENT_REGISTRY.some(
                (agent) =>
                  agent.id === agentId &&
                  agent.departmentId === classified.classification?.departmentId,
              ),
          ),
        'DIRECTOR_INVALID_LEDGER',
      );
    enforce(
      classified.status === 'classified'
        ? classified.classification &&
            classified.responsibleAgentId === classified.classification.proposedAgentId
        : classified.responsibleAgentId === 'carlos',
      'DIRECTOR_INVALID_LEDGER',
    );
    return {
      id,
      scope: { ...this.scope },
      submittedBy: received.subjectId,
      title: content.title,
      description: content.description,
      status: classified.status,
      priority: classified.priority,
      ownerId: 'carlos',
      responsibleAgentId: classified.responsibleAgentId,
      classification: classified.classification,
      reason: classified.reason,
      redacted: classified.redacted,
      hasUnknownConsumption: classified.hasUnknownConsumption,
      executionAllowed: false,
      createdAt: task.createdAt,
      updatedAt: events[1].updatedAt,
      history: events.map((event, index) => ({
        id: event.id,
        status: index === 0 ? 'received' : classified.status,
        createdAt: event.createdAt,
      })),
    };
  }
}
