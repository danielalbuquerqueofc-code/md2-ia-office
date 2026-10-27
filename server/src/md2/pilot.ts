import { createHash, randomUUID } from 'node:crypto';

import type { Md2OperatorAuth } from './operatorAuth.js';
import { redactMd2Text } from './sanitize.js';
import { enforce, Md2SecurityError } from './securityLedger.js';
import type { Md2Storage, StorageScope, StorageSnapshot } from './storage.js';

/**
 * Commercial pilot (internal only). Registers leads supplied by the operator, classifies them with
 * deterministic rules, prepares DRAFT messages and organizes next actions. It never sends a
 * message, books a meeting, scrapes a source or calls a model. Roles follow the agent registry:
 * Carlos coordinates, Lucas prospects, Fernanda qualifies, Rafael drafts proposals.
 */

export type LeadStage = 'new' | 'cold' | 'warm' | 'hot';
export type PilotAgent = 'carlos' | 'lucas' | 'fernanda' | 'rafael';
export type MessageKind = 'first-contact' | 'qualification' | 'proposal' | 'follow-up';

export interface LeadInput {
  /** Operator-chosen unique reference; repeating it returns the same lead. */
  reference: string;
  company: string;
  contactName?: string;
  role?: string;
  segment?: string;
  source: 'manual' | 'indicacao' | 'evento' | 'inbound' | 'base-propria';
  need?: string;
  notes?: string;
}
export interface PilotMessage {
  id: string;
  kind: MessageKind;
  author: PilotAgent;
  text: string;
  status: 'draft';
  /** Always false: the MD2 never sends messages; a human copies and sends outside the system. */
  sendable: false;
  createdAt: string;
}
export interface PilotAction {
  id: string;
  title: string;
  owner: PilotAgent;
  dueDate: string;
  done: boolean;
  createdAt: string;
}
export interface PilotLead extends Omit<LeadInput, 'reference'> {
  id: string;
  reference: string;
  stage: LeadStage;
  score: number | null;
  owner: PilotAgent;
  recommendation: string | null;
  messages: PilotMessage[];
  actions: PilotAction[];
  registeredBy: string;
  createdAt: string;
}

const SOURCES = ['manual', 'indicacao', 'evento', 'inbound', 'base-propria'];
const AGENTS: readonly PilotAgent[] = ['carlos', 'lucas', 'fernanda', 'rafael'];
const MESSAGE_AUTHOR: Record<MessageKind, PilotAgent> = {
  'first-contact': 'lucas',
  qualification: 'fernanda',
  proposal: 'rafael',
  'follow-up': 'carlos',
};
const DECISION_ROLE =
  /\b(diretor|diretora|ceo|dono|dona|socio|socia|fundador|fundadora|gerente|owner|presidente|head)\b/;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function clean(value: unknown, max: number, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    enforce(!required, 'PILOT_INVALID_INPUT');
    return undefined;
  }
  enforce(typeof value === 'string', 'PILOT_INVALID_INPUT');
  const text = value.trim();
  enforce(text.length > 0 && text.length <= max, 'PILOT_INVALID_INPUT');
  // Contact data (e-mail, phone) and secrets are not stored by the pilot.
  enforce(
    redactMd2Text(text) === text &&
      !/[\w.+-]+@[\w-]+\.[\w.]+/.test(text) &&
      !/(?:\+?\d[\s().-]?){9,}/.test(text),
    'PILOT_SENSITIVE_DATA',
  );
  return text;
}

export class Md2CommercialPilot {
  private readonly scope: StorageScope;
  constructor(
    private readonly store: Md2Storage,
    private readonly options: { scope: StorageScope; auth: Md2OperatorAuth },
  ) {
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
  }

  async registerLead(
    token: unknown,
    input: LeadInput,
  ): Promise<{ lead: PilotLead; duplicate: boolean }> {
    const operator = this.options.auth.authorize(token, 'queue.operate', this.scope);
    enforce(input && typeof input === 'object', 'PILOT_INVALID_INPUT');
    const reference = clean(input.reference, 80, true)!;
    enforce(/^[A-Za-z0-9._-]+$/.test(reference), 'PILOT_INVALID_INPUT');
    enforce(SOURCES.includes(input.source), 'PILOT_INVALID_INPUT');
    const data = {
      company: clean(input.company, 120, true)!,
      contactName: clean(input.contactName, 120),
      role: clean(input.role, 80),
      segment: clean(input.segment, 80),
      source: input.source,
      need: clean(input.need, 1000),
      notes: clean(input.notes, 1000),
    };
    const id =
      'lead-' +
      createHash('sha256')
        .update(JSON.stringify([this.scope.clientId, this.scope.projectId, reference]))
        .digest('hex')
        .slice(0, 40);
    const existing = (await this.snapshot()).data.tasks.find((task) => task.id === id);
    if (existing) return { lead: await this.lead(id), duplicate: true };
    await this.commit({
      tasks: [
        {
          id,
          agentId: 'lucas',
          status: 'created',
          prompt: JSON.stringify({ namespace: 'md2.pilot.lead.v1', reference, ...data }),
          output: '',
        },
      ],
      events: [this.event(id, { kind: 'registered', registeredBy: operator.subjectId })],
    });
    return { lead: await this.lead(id), duplicate: false };
  }

  /** Deterministic coordination by Carlos: score, stage, owner and a recommended next step. */
  async classify(token: unknown, leadId: string): Promise<PilotLead> {
    const operator = this.options.auth.authorize(token, 'queue.operate', this.scope);
    const lead = await this.lead(leadId);
    let score = 1; // company is required
    if (lead.role && DECISION_ROLE.test(normalize(lead.role))) score += 2;
    if (lead.need && lead.need.length >= 20) score += 2;
    if (['indicacao', 'evento', 'inbound'].includes(lead.source)) score += 1;
    if (lead.segment) score += 1;
    const stage: LeadStage = score >= 5 ? 'hot' : score >= 3 ? 'warm' : 'cold';
    const owner: PilotAgent = stage === 'hot' ? 'rafael' : stage === 'warm' ? 'fernanda' : 'lucas';
    const recommendation =
      stage === 'hot'
        ? 'Rafael prepara minuta de proposta para revisão humana.'
        : stage === 'warm'
          ? 'Fernanda prepara perguntas de qualificação para revisão humana.'
          : 'Lucas completa a pesquisa com informações fornecidas pelo operador.';
    await this.commit({
      events: [
        this.event(leadId, {
          kind: 'classified',
          score,
          stage,
          owner,
          recommendation,
          by: operator.subjectId,
        }),
      ],
    });
    return this.lead(leadId);
  }

  /** Template-based draft. Never sent by the system; status is always 'draft'. */
  async prepareMessage(token: unknown, leadId: string, kind: MessageKind): Promise<PilotMessage> {
    const operator = this.options.auth.authorize(token, 'queue.operate', this.scope);
    enforce(Object.prototype.hasOwnProperty.call(MESSAGE_AUTHOR, kind), 'PILOT_INVALID_INPUT');
    const lead = await this.lead(leadId);
    const name = lead.contactName ?? 'equipe';
    const need = lead.need ? ` Entendemos que o foco é: ${lead.need}.` : '';
    const text = {
      'first-contact':
        `Olá, ${name}. Sou da MD2 e acompanho empresas de ${lead.segment ?? 'seu segmento'}.` +
        `${need} Faz sentido conversarmos 15 minutos para entender as prioridades da ${lead.company}?`,
      qualification:
        `Olá, ${name}. Para preparar algo útil para a ${lead.company}, poderia confirmar: ` +
        '1) principal objetivo para os próximos meses; 2) quem participa da decisão; ' +
        '3) prazo desejado; 4) faixa de investimento prevista?',
      proposal:
        `Olá, ${name}. Segue o resumo da proposta para a ${lead.company}:${need} ` +
        'Escopo, cronograma e investimento estão descritos para sua revisão. [MINUTA — revisar valores e condições antes de enviar]',
      'follow-up':
        `Olá, ${name}. Retomando nosso contato sobre a ${lead.company}: ` +
        'há alguma dúvida que eu possa esclarecer ou um melhor momento para avançarmos?',
    }[kind];
    const message: PilotMessage = {
      id: 'message-' + randomUUID(),
      kind,
      author: MESSAGE_AUTHOR[kind],
      text: redactMd2Text(text),
      status: 'draft',
      sendable: false,
      createdAt: new Date().toISOString(),
    };
    await this.commit({
      events: [this.event(leadId, { kind: 'message', message, by: operator.subjectId })],
    });
    return message;
  }

  /** Internal next action only: no calendar, e-mail or external system is touched. */
  async addAction(
    token: unknown,
    leadId: string,
    input: { title: string; owner: PilotAgent; dueDate: string },
  ): Promise<PilotAction> {
    const operator = this.options.auth.authorize(token, 'queue.operate', this.scope);
    await this.lead(leadId);
    enforce(
      AGENTS.includes(input?.owner) &&
        typeof input.dueDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) &&
        !Number.isNaN(Date.parse(input.dueDate)),
      'PILOT_INVALID_INPUT',
    );
    const action: PilotAction = {
      id: 'action-' + randomUUID(),
      title: clean(input.title, 200, true)!,
      owner: input.owner,
      dueDate: input.dueDate,
      done: false,
      createdAt: new Date().toISOString(),
    };
    await this.commit({
      events: [this.event(leadId, { kind: 'action', action, by: operator.subjectId })],
    });
    return action;
  }

  async completeAction(token: unknown, leadId: string, actionId: string): Promise<PilotLead> {
    const operator = this.options.auth.authorize(token, 'queue.operate', this.scope);
    const lead = await this.lead(leadId);
    const action = lead.actions.find((item) => item.id === actionId);
    enforce(action, 'PILOT_ACTION_NOT_FOUND');
    if (!action.done)
      await this.commit({
        events: [this.event(leadId, { kind: 'action-done', actionId, by: operator.subjectId })],
      });
    return this.lead(leadId);
  }

  async list(token: unknown): Promise<PilotLead[]> {
    this.options.auth.authorize(token, 'queue.read', this.scope);
    const snapshot = await this.snapshot();
    return snapshot.data.tasks
      .filter((task) => task.id.startsWith('lead-'))
      .map((task) => this.project(snapshot, task.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(token: unknown, leadId: string): Promise<PilotLead> {
    this.options.auth.authorize(token, 'queue.read', this.scope);
    return this.lead(leadId);
  }

  private async lead(id: string): Promise<PilotLead> {
    enforce(typeof id === 'string' && /^lead-[a-f0-9]{40}$/.test(id), 'PILOT_LEAD_NOT_FOUND');
    return this.project(await this.snapshot(), id);
  }

  private project(snapshot: StorageSnapshot, id: string): PilotLead {
    const task = snapshot.data.tasks.find((item) => item.id === id);
    enforce(task, 'PILOT_LEAD_NOT_FOUND');
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(task.prompt);
    } catch {
      throw new Md2SecurityError('PILOT_INVALID_LEDGER');
    }
    enforce(data.namespace === 'md2.pilot.lead.v1', 'PILOT_INVALID_LEDGER');
    const lead: PilotLead = {
      id,
      reference: String(data.reference),
      company: String(data.company),
      contactName: data.contactName as string | undefined,
      role: data.role as string | undefined,
      segment: data.segment as string | undefined,
      source: data.source as LeadInput['source'],
      need: data.need as string | undefined,
      notes: data.notes as string | undefined,
      stage: 'new',
      score: null,
      owner: 'lucas',
      recommendation: null,
      messages: [],
      actions: [],
      registeredBy: '',
      createdAt: task.createdAt,
    };
    for (const event of snapshot.data.events) {
      if (event.taskId !== id || !event.id.startsWith('pilot-')) continue;
      const entry = JSON.parse(event.message) as Record<string, unknown>;
      if (entry.namespace !== 'md2.pilot.v1') continue;
      if (entry.kind === 'registered') lead.registeredBy = String(entry.registeredBy);
      if (entry.kind === 'classified') {
        lead.score = entry.score as number;
        lead.stage = entry.stage as LeadStage;
        lead.owner = entry.owner as PilotAgent;
        lead.recommendation = entry.recommendation as string;
      }
      if (entry.kind === 'message') lead.messages.push(entry.message as PilotMessage);
      if (entry.kind === 'action') lead.actions.push(entry.action as PilotAction);
      if (entry.kind === 'action-done') {
        const action = lead.actions.find((item) => item.id === entry.actionId);
        if (action) action.done = true;
      }
    }
    return lead;
  }

  private event(taskId: string, body: Record<string, unknown>) {
    const message = JSON.stringify({ namespace: 'md2.pilot.v1', ...body });
    enforce(redactMd2Text(message) === message, 'PILOT_SENSITIVE_DATA');
    return { id: 'pilot-' + randomUUID(), taskId, type: 'note' as const, message };
  }

  private async snapshot(): Promise<StorageSnapshot> {
    const snapshot = await this.store.read();
    enforce(
      snapshot &&
        snapshot.clientId === this.scope.clientId &&
        snapshot.projectId === this.scope.projectId,
      'PILOT_SCOPE_MISMATCH',
    );
    return snapshot;
  }

  private async commit(changes: Parameters<Md2Storage['commit']>[0]): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.snapshot();
      try {
        await this.store.commit(changes, snapshot.revision);
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'CONFLICT') throw error;
      }
    }
    throw new Md2SecurityError('PILOT_CONFLICT_RETRY_LIMIT');
  }
}
