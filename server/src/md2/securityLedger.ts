import { randomUUID } from 'node:crypto';

import { MD2_AGENT_REGISTRY } from '../../../core/src/md2AgentRegistry.js';
import { redactMd2Text } from './sanitize.js';
import type { Md2Storage, StorageChanges, StorageSnapshot } from './storage.js';
import { Md2StorageError, requireStorage, validId } from './storageSchema.js';

export type SecurityStore = Pick<Md2Storage, 'read' | 'commit'>;
export class Md2SecurityError extends Error {
  constructor(public readonly code: string) {
    super(`MD2 security: ${code}`);
    this.name = 'Md2SecurityError';
  }
}
export function enforce(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Md2SecurityError(code);
}
export function knownAgent(id: string): boolean {
  return MD2_AGENT_REGISTRY.some((agent) => agent.id === id);
}
export function requireTask(snapshot: StorageSnapshot, taskId: string, agentId: string): void {
  enforce(
    validId(taskId) &&
      knownAgent(agentId) &&
      snapshot.data.tasks.some(
        (task) =>
          task.id === taskId &&
          task.agentId === agentId &&
          ['created', 'running', 'approval'].includes(task.status),
      ),
    'TASK_SCOPE_OR_STATE',
  );
}
export async function readSecurityStore(store: SecurityStore): Promise<StorageSnapshot> {
  const snapshot = await store.read();
  enforce(snapshot, 'STORAGE_NOT_INITIALIZED');
  return snapshot;
}
/** Optimistic storage revisions serialize decisions/consumption across policy instances. */
export async function appendSecurityEvent<T>(
  store: SecurityStore,
  prefix: 'policy' | 'limits',
  decide: (snapshot: StorageSnapshot) => {
    taskId: string;
    record: object;
    result: T;
    changes?: StorageChanges;
  },
): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const snapshot = await readSecurityStore(store);
    const { taskId, record, result, changes } = decide(snapshot);
    const message = JSON.stringify({ namespace: `md2.${prefix}.v1`, ...record });
    enforce(redactMd2Text(message) === message, 'SENSITIVE_SECURITY_METADATA');
    try {
      await store.commit(
        {
          ...changes,
          events: [
            ...(changes?.events ?? []),
            {
              id: `${prefix}-${randomUUID()}`,
              taskId,
              type: prefix === 'policy' ? 'approval' : 'status',
              message,
            },
          ],
        },
        snapshot.revision,
      );
      return result;
    } catch (error) {
      if (!(error instanceof Md2StorageError) || error.code !== 'CONFLICT') throw error;
    }
  }
  throw new Md2SecurityError('CONFLICT_RETRY_LIMIT');
}
export function securityRecords(
  snapshot: StorageSnapshot,
  prefix: 'policy' | 'limits',
): Record<string, unknown>[] {
  return snapshot.data.events
    .filter((event) => event.id.startsWith(prefix + '-'))
    .map((event) => {
      let record: unknown;
      try {
        record = JSON.parse(event.message);
      } catch {
        throw new Md2SecurityError('INVALID_SECURITY_LEDGER');
      }
      requireStorage(
        !!record && typeof record === 'object' && !Array.isArray(record),
        'Registro de segurança inválido.',
      );
      const value = record as Record<string, unknown>;
      enforce(
        value.namespace === `md2.${prefix}.v1` && value.taskId === event.taskId,
        'INVALID_SECURITY_LEDGER',
      );
      return value;
    });
}
