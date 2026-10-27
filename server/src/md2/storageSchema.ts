import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { MD2_AGENT_REGISTRY } from '../../../core/src/md2AgentRegistry.js';
import type { Md2Approval, Md2Task } from './office.js';

export interface StorageScope {
  clientId: string;
  projectId: string;
}
interface RecordTimes {
  createdAt: string;
  updatedAt: string;
}
export interface StoredAgent extends RecordTimes {
  id: string;
  status: 'inactive' | 'ready' | 'busy' | 'error';
}
export interface StoredTask extends RecordTimes {
  id: string;
  agentId: string;
  status: 'created' | Md2Task['status'];
  prompt: string;
  output: string;
}
export interface StoredApproval extends RecordTimes {
  id: string;
  taskId: string;
  method: 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval';
  status: Md2Approval['status'];
  reviewable: boolean;
  summary: string;
}
export interface StoredEvent extends RecordTimes {
  id: string;
  taskId: string;
  type: 'status' | 'approval' | 'error' | 'note';
  message: string;
}
export interface StorageData {
  agents: StoredAgent[];
  tasks: StoredTask[];
  approvals: StoredApproval[];
  events: StoredEvent[];
}
export interface StorageSnapshot extends StorageScope {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  data: StorageData;
  checksum: string;
}
export interface StorageLimits {
  maxFileBytes: number;
  maxRecordBytes: number;
  maxRecords: number;
  retentionDays: number;
}
export const DEFAULT_STORAGE_LIMITS: Readonly<StorageLimits> = Object.freeze({
  maxFileBytes: 10 * 1024 * 1024,
  maxRecordBytes: 64 * 1024,
  maxRecords: 10000,
  retentionDays: 90,
});
export type StorageChanges = {
  [K in keyof StorageData]?: Omit<StorageData[K][number], keyof RecordTimes>[];
};

export class Md2StorageError extends Error {
  constructor(
    public readonly code: 'INVALID' | 'CORRUPT' | 'LIMIT' | 'CONFLICT' | 'RECOVERY_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'Md2StorageError';
  }
}
export function requireStorage(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Md2StorageError('INVALID', message);
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}
function validTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  requireStorage(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
    'Campos de armazenamento inválidos.',
  );
}

// Reject common credential formats. Free text still needs review before being supplied here.
const credential =
  /(?:\bBearer\s+\S+|\bsk-(?:proj-)?[a-zA-Z0-9_-]{16,}|\bgh[pousr]_[a-zA-Z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|senha|secret|authorization)\s*[=:]\s*\S+)/i;
function text(value: unknown): void {
  requireStorage(
    typeof value === 'string' && !credential.test(value),
    'Texto inválido ou possível credencial; conteúdo não persistido.',
  );
}
export function checksum(snapshot: Omit<StorageSnapshot, 'checksum'>): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
export function seal(snapshot: Omit<StorageSnapshot, 'checksum'>): StorageSnapshot {
  return { ...snapshot, checksum: checksum(snapshot) };
}
export function initialData(now: string): StorageData {
  return {
    agents: MD2_AGENT_REGISTRY.map((agent) => ({
      id: agent.id,
      status: agent.initialState,
      createdAt: now,
      updatedAt: now,
    })),
    tasks: [],
    approvals: [],
    events: [],
  };
}

/** Strict schema, referential integrity, state invariants and accidental-secret checks. */
export function validateSnapshot(
  value: unknown,
  scope: StorageScope,
  limits: StorageLimits,
): asserts value is StorageSnapshot {
  requireStorage(object(value), 'Documento MD2 inválido.');
  keys(value, [
    'schemaVersion',
    'revision',
    'clientId',
    'projectId',
    'updatedAt',
    'data',
    'checksum',
  ]);
  requireStorage(
    value.schemaVersion === 1,
    'Versão de esquema MD2 não suportada; migração explícita necessária.',
  );
  requireStorage(
    value.clientId === scope.clientId && value.projectId === scope.projectId,
    'Escopo MD2 divergente.',
  );
  requireStorage(
    Number.isSafeInteger(value.revision) &&
      (value.revision as number) >= 1 &&
      validTime(value.updatedAt),
    'Metadados MD2 inválidos.',
  );
  const { checksum: saved, ...payload } = value;
  requireStorage(
    typeof saved === 'string' && saved === checksum(payload as Omit<StorageSnapshot, 'checksum'>),
    'Checksum MD2 divergente.',
  );
  requireStorage(object(value.data), 'Coleções MD2 inválidas.');
  keys(value.data, ['agents', 'tasks', 'approvals', 'events']);
  let total = 0;
  for (const kind of ['agents', 'tasks', 'approvals', 'events'] as const) {
    const records = value.data[kind];
    requireStorage(Array.isArray(records), 'Coleção MD2 inválida.');
    total += records.length;
    const ids = new Set<string>();
    for (const record of records) {
      requireStorage(
        object(record) && validId(record.id) && !ids.has(record.id),
        'ID MD2 inválido ou duplicado.',
      );
      ids.add(record.id);
      requireStorage(
        validTime(record.createdAt) &&
          validTime(record.updatedAt) &&
          record.createdAt <= record.updatedAt &&
          record.updatedAt <= value.updatedAt,
        'Timestamps MD2 inválidos.',
      );
      const common = ['id', 'createdAt', 'updatedAt'];
      if (kind !== 'events')
        requireStorage(typeof record.status === 'string', 'Estado MD2 inválido.');
      if (kind === 'agents') {
        keys(record, [...common, 'status']);
        requireStorage(
          MD2_AGENT_REGISTRY.some((agent) => agent.id === record.id) &&
            ['inactive', 'ready', 'busy', 'error'].includes(String(record.status)),
          'Estado de agente MD2 inválido.',
        );
      } else if (kind === 'tasks') {
        keys(record, [...common, 'agentId', 'status', 'prompt', 'output']);
        requireStorage(
          MD2_AGENT_REGISTRY.some((agent) => agent.id === record.agentId) &&
            ['created', 'running', 'approval', 'completed', 'failed', 'interrupted'].includes(
              String(record.status),
            ),
          'Tarefa MD2 inválida.',
        );
        text(record.prompt);
        text(record.output);
      } else if (kind === 'approvals') {
        keys(record, [...common, 'taskId', 'method', 'status', 'reviewable', 'summary']);
        requireStorage(typeof record.method === 'string', 'Método de aprovação MD2 inválido.');
        requireStorage(
          ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
            String(record.method),
          ) &&
            ['pending', 'accepted', 'declined', 'expired'].includes(String(record.status)) &&
            typeof record.reviewable === 'boolean',
          'Aprovação MD2 inválida.',
        );
        requireStorage(
          record.status !== 'accepted' || record.reviewable,
          'Aprovação sem prévia revisável.',
        );
        text(record.summary);
      } else {
        keys(record, [...common, 'taskId', 'type', 'message']);
        requireStorage(typeof record.type === 'string', 'Tipo de evento MD2 inválido.');
        requireStorage(
          ['status', 'approval', 'error', 'note'].includes(String(record.type)),
          'Evento MD2 inválido.',
        );
        text(record.message);
      }
      if (Buffer.byteLength(JSON.stringify(record)) > limits.maxRecordBytes)
        throw new Md2StorageError('LIMIT', 'Registro excede limite de tamanho.');
    }
  }
  if (total > limits.maxRecords)
    throw new Md2StorageError(
      'LIMIT',
      'Limite de registros excedido; nenhum histórico foi removido.',
    );
  const data = value.data as unknown as StorageData;
  requireStorage(
    data.agents.length === MD2_AGENT_REGISTRY.length,
    'Cadastro persistido deve conter os 22 agentes.',
  );
  requireStorage(
    data.tasks.filter((task) => ['running', 'approval'].includes(task.status)).length <= 1 &&
      data.agents.filter((agent) => agent.status === 'busy').length <= 1,
    'Concorrência MD2 excede um.',
  );
  for (const record of [...data.events, ...data.approvals]) {
    const task = data.tasks.find((item) => item.id === record.taskId);
    requireStorage(
      task && task.createdAt <= record.createdAt,
      'Referência de tarefa MD2 inválida.',
    );
    if ('status' in record && record.status === 'pending')
      requireStorage(
        ['running', 'approval'].includes(task.status),
        'Aprovação pendente exige tarefa ativa.',
      );
  }
}

const transitions: Record<'agents' | 'tasks' | 'approvals', Record<string, readonly string[]>> = {
  agents: {
    inactive: ['ready'],
    ready: ['inactive', 'busy', 'error'],
    busy: ['ready', 'error', 'inactive'],
    error: ['inactive', 'ready'],
  },
  tasks: {
    created: ['running', 'interrupted'],
    running: ['approval', 'completed', 'failed', 'interrupted'],
    approval: ['running', 'failed', 'interrupted'],
    completed: [],
    failed: [],
    interrupted: [],
  },
  approvals: {
    pending: ['accepted', 'declined', 'expired'],
    accepted: [],
    declined: [],
    expired: [],
  },
};

export function applyChanges(
  previous: StorageData,
  changes: StorageChanges,
  now: string,
): StorageData {
  requireStorage(
    object(changes) &&
      Object.keys(changes).every((key) => ['agents', 'tasks', 'approvals', 'events'].includes(key)),
    'Alterações MD2 inválidas.',
  );
  const data: StorageData = structuredClone(previous);
  for (const kind of ['agents', 'tasks', 'approvals', 'events'] as const) {
    const updates = changes[kind];
    if (updates === undefined) continue;
    requireStorage(Array.isArray(updates), 'Alterações MD2 devem ser listas.');
    const seen = new Set<string>();
    for (const input of updates) {
      requireStorage(
        object(input) &&
          validId(input.id) &&
          !seen.has(input.id) &&
          !('createdAt' in input) &&
          !('updatedAt' in input),
        'Alteração MD2 inválida ou duplicada.',
      );
      seen.add(input.id);
      const records = data[kind] as (StoredAgent | StoredTask | StoredApproval | StoredEvent)[];
      const index = records.findIndex((record) => record.id === input.id);
      const old = records[index];
      requireStorage(kind !== 'agents' || !!old, 'Identidade empresarial desconhecida.');
      if (old) {
        requireStorage(kind !== 'events', 'Eventos persistidos são imutáveis.');
        const next = input as Omit<StoredAgent | StoredTask | StoredApproval, keyof RecordTimes>;
        const prior = old as StoredAgent | StoredTask | StoredApproval;
        requireStorage(
          next.status === prior.status || transitions[kind][prior.status]?.includes(next.status),
          'Transição MD2 inválida.',
        );
        if (kind === 'tasks')
          requireStorage(
            (input as StoredTask).agentId === (old as StoredTask).agentId &&
              (input as StoredTask).prompt === (old as StoredTask).prompt,
            'Identidade e solicitação da tarefa são imutáveis.',
          );
        const oldFields = Object.fromEntries(
          Object.entries(old).filter(([key]) => !['createdAt', 'updatedAt'].includes(key)),
        );
        if (kind === 'approvals')
          requireStorage(
            isDeepStrictEqual({ ...input, status: undefined }, { ...oldFields, status: undefined }),
            'Conteúdo da aprovação é imutável.',
          );
        if (
          (kind === 'approvals' && prior.status !== 'pending') ||
          (kind === 'tasks' && ['completed', 'failed', 'interrupted'].includes(prior.status))
        ) {
          requireStorage(isDeepStrictEqual(input, oldFields), 'Registro encerrado é imutável.');
          continue;
        }
      } else {
        if (kind === 'tasks')
          requireStorage(
            (input as StoredTask).status === 'created',
            'Nova tarefa deve iniciar criada.',
          );
        if (kind === 'approvals')
          requireStorage(
            (input as StoredApproval).status === 'pending',
            'Nova aprovação deve iniciar pendente.',
          );
      }
      const record = { ...input, createdAt: old?.createdAt ?? now, updatedAt: now } as typeof old;
      if (old) records[index] = record;
      else records.push(record);
    }
  }
  return data;
}
