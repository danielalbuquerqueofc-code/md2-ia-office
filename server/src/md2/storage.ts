import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { sanitizeMd2Changes } from './sanitize.js';
import {
  applyChanges,
  DEFAULT_STORAGE_LIMITS,
  initialData,
  Md2StorageError,
  requireStorage,
  seal,
  type StorageChanges,
  type StorageLimits,
  type StorageScope,
  type StorageSnapshot,
  validateSnapshot,
  validId,
} from './storageSchema.js';

export type {
  StorageChanges,
  StorageData,
  StorageLimits,
  StorageScope,
  StorageSnapshot,
  StoredAgent,
  StoredApproval,
  StoredEvent,
  StoredTask,
} from './storageSchema.js';
export { Md2StorageError } from './storageSchema.js';

// Shared by every instance in this process. Each operation reloads disk under this lock.
const operations = new Map<string, Promise<unknown>>();
function serial<T>(key: string, operation: () => T): Promise<T> {
  const previous = operations.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  operations.set(key, next);
  void next
    .finally(() => {
      if (operations.get(key) === next) operations.delete(key);
    })
    .catch(() => {});
  return next;
}
function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Local, single-process storage only. It does not bind to or launch the Codex executor. */
export class Md2Storage {
  readonly file: string;
  readonly legacyFile: string;
  private readonly scope: StorageScope;
  private readonly limits: StorageLimits;
  private readonly directory: string;
  private readonly root: string;
  private readonly key: string;

  constructor(options: { root: string; scope: StorageScope; limits?: Partial<StorageLimits> }) {
    requireStorage(
      validId(options.scope.clientId) && validId(options.scope.projectId),
      'Cliente/projeto MD2 inválido.',
    );
    this.scope = { clientId: options.scope.clientId, projectId: options.scope.projectId };
    this.limits = { ...DEFAULT_STORAGE_LIMITS, ...options.limits };
    for (const value of Object.values(this.limits))
      requireStorage(Number.isSafeInteger(value) && value > 0, 'Limite MD2 inválido.');
    this.root = fs.realpathSync(options.root);
    const namespace = createHash('sha256').update(JSON.stringify(this.scope)).digest('hex');
    this.directory = path.join(this.root, '.md2-office', 'storage', namespace);
    this.file = path.join(this.directory, 'state-v1.json');
    this.legacyFile = path.join(this.root, '.md2-office', 'tasks.json');
    this.key = process.platform === 'win32' ? this.file.toLowerCase() : this.file;
    this.checkPaths();
  }

  read(): Promise<StorageSnapshot | null> {
    return serial(this.key, () => this.readCurrent());
  }

  initialize(): Promise<StorageSnapshot> {
    return serial(this.key, () => {
      this.checkPaths();
      this.requireNoPending();
      const current = this.readCurrent();
      if (current) return current;
      const now = new Date().toISOString();
      const snapshot = seal({
        ...this.scope,
        schemaVersion: 1,
        revision: 1,
        updatedAt: now,
        data: initialData(now),
      });
      this.persist(snapshot, null);
      return snapshot;
    });
  }

  /** Upsert only: histories cannot be deleted through this API. Timestamps are storage-owned. */
  commit(changes: StorageChanges, expectedRevision: number): Promise<StorageSnapshot> {
    // Copy before queueing, so callers cannot mutate an operation while it waits.
    let copied: StorageChanges;
    try {
      copied = structuredClone(changes);
    } catch {
      return Promise.reject(new Md2StorageError('INVALID', 'Alterações MD2 não serializáveis.'));
    }
    return serial(this.key, () => {
      this.checkPaths();
      this.requireNoPending();
      const current = this.readCurrent();
      if (!current || current.revision !== expectedRevision)
        throw new Md2StorageError('CONFLICT', 'Revisão MD2 divergente; releia antes de gravar.');
      const now = new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString();
      const snapshot = seal({
        ...this.scope,
        schemaVersion: 1,
        revision: current.revision + 1,
        updatedAt: now,
        data: applyChanges(current.data, sanitizeMd2Changes(copied, current.data), now),
      });
      this.persist(snapshot, current);
      return snapshot;
    });
  }

  /** Report retention candidates only. No pruning, implicit archival or deletion. */
  retentionCandidates(
    now = new Date(),
  ): Promise<{ tasks: string[]; events: string[]; approvals: string[] }> {
    return serial(this.key, () => {
      requireStorage(!Number.isNaN(now.getTime()), 'Data de retenção inválida.');
      const current = this.readCurrent();
      const cutoff = now.getTime() - this.limits.retentionDays * 86400000;
      const tasks =
        current?.data.tasks
          .filter(
            (task) =>
              ['completed', 'failed', 'interrupted'].includes(task.status) &&
              Date.parse(task.updatedAt) < cutoff,
          )
          .map((task) => task.id) ?? [];
      return {
        tasks,
        events:
          current?.data.events
            .filter((event) => tasks.includes(event.taskId) && Date.parse(event.updatedAt) < cutoff)
            .map((event) => event.id) ?? [],
        approvals:
          current?.data.approvals
            .filter(
              (approval) =>
                approval.status !== 'pending' &&
                tasks.includes(approval.taskId) &&
                Date.parse(approval.updatedAt) < cutoff,
            )
            .map((approval) => approval.id) ?? [],
      };
    });
  }

  /** Read-only preflight for a future migration; never imports or rewrites the legacy ledger. */
  inspectLegacy(): Promise<{
    exists: boolean;
    tasks: number;
    approvals: number;
    migrationRequired: boolean;
  }> {
    return serial(this.key, () => {
      this.checkPaths();
      if (!exists(this.legacyFile))
        return { exists: false, tasks: 0, approvals: 0, migrationRequired: false };
      const parsed: unknown = this.parseFile(this.legacyFile);
      requireStorage(
        !!parsed &&
          typeof parsed === 'object' &&
          'tasks' in parsed &&
          'approvals' in parsed &&
          Array.isArray(parsed.tasks) &&
          Array.isArray(parsed.approvals),
        'Histórico legado inválido; preservado para revisão.',
      );
      return {
        exists: true,
        tasks: parsed.tasks.length,
        approvals: parsed.approvals.length,
        migrationRequired: true,
      };
    });
  }

  inspectRecovery(): Promise<
    Record<'current' | 'backup' | 'pending', 'missing' | 'valid' | 'invalid'>
  > {
    return serial(this.key, () => {
      this.checkPaths();
      const inspect = (file: string) => {
        if (!exists(file)) return 'missing' as const;
        try {
          this.readSnapshot(file);
          return 'valid' as const;
        } catch {
          return 'invalid' as const;
        }
      };
      return {
        current: inspect(this.file),
        backup: inspect(this.file + '.backup'),
        pending: inspect(this.file + '.pending'),
      };
    });
  }

  /** Explicit recovery only. Original current/pending bytes are archived before replacement. */
  recover(source: 'backup' | 'pending'): Promise<StorageSnapshot> {
    return serial(this.key, () => {
      requireStorage(source === 'backup' || source === 'pending', 'Fonte de recuperação inválida.');
      this.checkPaths();
      const candidate = this.readSnapshot(this.file + '.' + source);
      let current: StorageSnapshot | null = null;
      if (exists(this.file)) {
        try {
          current = this.readSnapshot(this.file);
        } catch (error) {
          if (
            source === 'pending' ||
            !(error instanceof Md2StorageError) ||
            error.code !== 'CORRUPT'
          )
            throw error;
        }
      }
      if (source === 'pending') {
        const base =
          current ??
          (exists(this.file + '.backup') ? this.readSnapshot(this.file + '.backup') : null);
        requireStorage(
          candidate.revision === (base?.revision ?? 0) + 1,
          'Revisão pendente incompatível; revisão manual necessária.',
        );
      }
      // A backup precedes its original primary by one revision. Skip that revision on
      // restoration so stale callers cannot accidentally write over recovered state.
      const { checksum: previousChecksum, ...payload } = candidate;
      void previousChecksum;
      const snapshot = seal({
        ...payload,
        revision: Math.max(
          candidate.revision + (source === 'backup' ? 2 : 1),
          (current?.revision ?? 0) + 1,
        ),
        updatedAt: new Date(
          Math.max(
            Date.now(),
            Date.parse(candidate.updatedAt),
            Date.parse(current?.updatedAt ?? candidate.updatedAt),
          ),
        ).toISOString(),
      });
      validateSnapshot(snapshot, this.scope, this.limits);
      const content = JSON.stringify(snapshot);
      if (Buffer.byteLength(content) > this.limits.maxFileBytes)
        throw new Md2StorageError(
          'LIMIT',
          'Recuperação excederia o limite de tamanho; arquivos preservados.',
        );
      for (const file of [this.file, this.file + '.pending']) {
        if (exists(file)) {
          if (fs.statSync(file).size > this.limits.maxFileBytes)
            throw new Md2StorageError(
              'LIMIT',
              'Arquivo de recuperação excede limite; revisão manual necessária.',
            );
          this.writeExclusive(file + '.preserved-' + randomUUID(), fs.readFileSync(file));
        }
      }
      const temporary = this.file + '.recovery-' + randomUUID();
      this.writeExclusive(temporary, content);
      fs.renameSync(temporary, this.file);
      if (exists(this.file + '.pending'))
        fs.renameSync(this.file + '.pending', this.file + '.pending-resolved-' + randomUUID());
      this.syncDirectory();
      return snapshot;
    });
  }

  private checkPaths(): void {
    for (const directory of [
      path.join(this.root, '.md2-office'),
      path.join(this.root, '.md2-office', 'storage'),
      this.directory,
    ]) {
      if (exists(directory))
        requireStorage(
          !fs.lstatSync(directory).isSymbolicLink() && fs.lstatSync(directory).isDirectory(),
          'Diretório MD2 inseguro.',
        );
    }
    for (const file of [
      this.file,
      this.file + '.backup',
      this.file + '.pending',
      this.legacyFile,
    ]) {
      if (exists(file))
        requireStorage(
          !fs.lstatSync(file).isSymbolicLink() && fs.lstatSync(file).isFile(),
          'Arquivo MD2 inseguro.',
        );
    }
  }
  private requireNoPending(): void {
    if (exists(this.file + '.pending'))
      throw new Md2StorageError(
        'RECOVERY_REQUIRED',
        'Gravação pendente encontrada; inspecione e recupere explicitamente.',
      );
  }
  private parseFile(file: string): unknown {
    if (fs.statSync(file).size > this.limits.maxFileBytes)
      throw new Md2StorageError('LIMIT', 'Arquivo excede limite de tamanho; preservado.');
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Md2StorageError('CORRUPT', 'JSON MD2 inválido; arquivo preservado.');
    }
  }
  private readSnapshot(file: string): StorageSnapshot {
    const parsed = this.parseFile(file);
    try {
      validateSnapshot(parsed, this.scope, this.limits);
    } catch (error) {
      if (error instanceof Md2StorageError && error.code === 'LIMIT') throw error;
      throw new Md2StorageError(
        'CORRUPT',
        'Integridade ou esquema MD2 inválido; arquivo preservado.',
      );
    }
    return parsed;
  }
  private readCurrent(): StorageSnapshot | null {
    this.checkPaths();
    if (exists(this.file)) return this.readSnapshot(this.file);
    if (exists(this.file + '.pending') || exists(this.file + '.backup'))
      throw new Md2StorageError(
        'RECOVERY_REQUIRED',
        'Arquivo principal ausente com dados recuperáveis; revisão necessária.',
      );
    return null;
  }
  private writeExclusive(file: string, content: string | Buffer): void {
    const descriptor = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
  private persist(snapshot: StorageSnapshot, current: StorageSnapshot | null): void {
    validateSnapshot(snapshot, this.scope, this.limits);
    const content = JSON.stringify(snapshot);
    if (Buffer.byteLength(content) > this.limits.maxFileBytes)
      throw new Md2StorageError(
        'LIMIT',
        'Arquivo excederia limite; gravação recusada sem remover histórico.',
      );
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.checkPaths();
    // A fixed exclusive pending file also fails closed if another process attempts a write.
    this.writeExclusive(this.file + '.pending', content);
    if (current) {
      const backup = this.file + '.backup-' + randomUUID();
      this.writeExclusive(backup, JSON.stringify(current));
      fs.renameSync(backup, this.file + '.backup');
    }
    fs.renameSync(this.file + '.pending', this.file);
    this.syncDirectory();
  }
  private syncDirectory(): void {
    // Windows does not support fsync on directory handles via this API.
    if (process.platform === 'win32') return;
    const descriptor = fs.openSync(this.directory, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}
