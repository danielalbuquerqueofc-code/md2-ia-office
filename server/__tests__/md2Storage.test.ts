import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Md2Storage, type StorageChanges, type StorageSnapshot } from '../src/md2/storage.js';
import { seal } from '../src/md2/storageSchema.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync), fsyncSync: vi.fn(actual.fsyncSync) };
});

const scope = { clientId: 'client-a', projectId: 'project-a' };
const task = (id = 'task-1') => ({
  id,
  agentId: 'andre',
  status: 'created' as const,
  prompt: 'Preparar uma proposta técnica.',
  output: '',
});
const approval = () => ({
  id: 'approval-1',
  taskId: 'task-1',
  method: 'item/fileChange/requestApproval' as const,
  status: 'pending' as const,
  reviewable: true,
  summary: 'Revisar a alteração proposta.',
});
const event = (id = 'event-1') => ({
  id,
  taskId: 'task-1',
  type: 'note' as const,
  message: 'Registro de acompanhamento.',
});

describe('MD2 local persistent storage', () => {
  let root: string;
  let store: Md2Storage;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(tmpdir(), 'md2-storage-'));
    store = new Md2Storage({ root, scope });
  });
  afterEach(() => {
    vi.mocked(fs.renameSync).mockReset();
    vi.mocked(fs.fsyncSync).mockReset();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function created() {
    await store.initialize();
    return store.commit({ tasks: [task()] }, 1);
  }
  async function running() {
    await created();
    return store.commit({ tasks: [{ ...task(), status: 'running' }] }, 2);
  }
  function rewrite(snapshot: StorageSnapshot) {
    const { checksum: ignored, ...payload } = snapshot;
    void ignored;
    fs.writeFileSync(store.file, JSON.stringify(seal(payload)));
  }

  it('reads an absent store without writing and initializes 22 inactive identities once', async () => {
    expect(await store.read()).toBeNull();
    expect(fs.existsSync(path.join(root, '.md2-office'))).toBe(false);
    const initialized = await store.initialize();
    expect(initialized).toMatchObject({ schemaVersion: 1, revision: 1, ...scope });
    expect(initialized.data.agents).toHaveLength(22);
    expect(initialized.data.agents.every((agent) => agent.status === 'inactive')).toBe(true);
    const bytes = fs.readFileSync(store.file);
    expect(await store.initialize()).toEqual(initialized);
    expect(fs.readFileSync(store.file)).toEqual(bytes);
  });

  it('persists all record types across restart with stable IDs and storage-owned timestamps', async () => {
    await running();
    const saved = await store.commit(
      {
        tasks: [{ ...task(), status: 'approval' }],
        approvals: [approval()],
        events: [event()],
        agents: [{ id: 'andre', status: 'ready' }],
      },
      3,
    );
    const restarted = new Md2Storage({ root, scope });
    expect(await restarted.read()).toEqual(saved);
    expect(saved.data.tasks[0].id).toBe('task-1');
    expect(saved.data.tasks[0].createdAt <= saved.data.tasks[0].updatedAt).toBe(true);
    expect(await restarted.inspectRecovery()).toEqual({
      current: 'valid',
      backup: 'valid',
      pending: 'missing',
    });
    // Restarting storage does not activate, interrupt, resume or authorize anything.
    expect((await restarted.read())?.data.approvals[0].status).toBe('pending');
  });

  it('returns independent data and copies requests before queued operations run', async () => {
    await store.initialize();
    const input = task();
    const pending = store.commit({ tasks: [input] }, 1);
    input.prompt = 'Modificado depois da chamada.';
    const saved = await pending;
    saved.data.tasks.length = 0;
    expect((await store.read())?.data.tasks[0].prompt).toBe(task().prompt);
  });

  it('serializes initialization across instances sharing the same file', async () => {
    const second = new Md2Storage({ root, scope });
    const results = await Promise.all([
      store.initialize(),
      second.initialize(),
      store.initialize(),
    ]);
    expect(results.map((item) => item.revision)).toEqual([1, 1, 1]);
    expect(await store.read()).toEqual(results[0]);
  });

  it('uses the same namespace regardless of scope property order', async () => {
    const second = new Md2Storage({
      root,
      scope: { projectId: scope.projectId, clientId: scope.clientId },
    });
    expect(second.file).toBe(store.file);
    const original = await store.initialize();
    expect(await second.read()).toEqual(original);
  });

  it('rejects stale concurrent writes without losing data and permits an explicit retry', async () => {
    await created();
    const second = new Md2Storage({ root, scope });
    const results = await Promise.allSettled([
      store.commit({ events: [event('event-a')] }, 2),
      second.commit({ events: [event('event-b')] }, 2),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'CONFLICT' } });
    await second.commit({ events: [event('event-b')] }, 3);
    expect((await store.read())?.data.events.map((item) => item.id)).toEqual([
      'event-a',
      'event-b',
    ]);
  });

  it('segregates clients and projects physically and validates scope on read', async () => {
    const a = await store.initialize();
    for (const otherScope of [
      { ...scope, clientId: 'client-b' },
      { ...scope, projectId: 'project-b' },
    ]) {
      const other = new Md2Storage({ root, scope: otherScope });
      expect(other.file).not.toBe(store.file);
      expect(await other.read()).toBeNull();
      await other.initialize();
      fs.copyFileSync(store.file, other.file);
      await expect(other.read()).rejects.toMatchObject({ code: 'CORRUPT' });
    }
    expect(await store.read()).toEqual(a);
    expect(() => new Md2Storage({ root, scope: { ...scope, projectId: '../escape' } })).toThrow();
  });

  it.each(['{"broken":', '', 'null'])(
    'preserves corrupt JSON and refuses reads and writes (%#)',
    async (content) => {
      await store.initialize();
      fs.writeFileSync(store.file, content);
      await expect(store.read()).rejects.toMatchObject({ code: 'CORRUPT' });
      await expect(store.commit({ tasks: [task()] }, 1)).rejects.toMatchObject({ code: 'CORRUPT' });
      expect(fs.readFileSync(store.file, 'utf8')).toBe(content);
      expect(fs.existsSync(store.file + '.pending')).toBe(false);
    },
  );

  it('detects checksum tampering without replacing the primary or backup', async () => {
    await created();
    const backup = fs.readFileSync(store.file + '.backup');
    const saved = JSON.parse(fs.readFileSync(store.file, 'utf8')) as StorageSnapshot;
    saved.data.tasks[0].output = 'Alterado externamente';
    fs.writeFileSync(store.file, JSON.stringify(saved));
    const corrupt = fs.readFileSync(store.file);
    await expect(store.initialize()).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(fs.readFileSync(store.file)).toEqual(corrupt);
    expect(fs.readFileSync(store.file + '.backup')).toEqual(backup);
  });

  it.each(['version', 'timestamp', 'reference', 'duplicate', 'extra-field'])(
    'rejects semantically invalid persisted data with a valid checksum (%s)',
    async (kind) => {
      const saved = await created();
      if (kind === 'version') Object.assign(saved, { schemaVersion: 2 });
      if (kind === 'timestamp') saved.data.tasks[0].createdAt = 'yesterday';
      if (kind === 'reference') saved.data.tasks[0].agentId = 'unknown';
      if (kind === 'duplicate') saved.data.tasks.push(saved.data.tasks[0]);
      if (kind === 'extra-field') Object.assign(saved.data.tasks[0], { credentials: 'proibido' });
      rewrite(saved);
      const original = fs.readFileSync(store.file);
      await expect(store.read()).rejects.toMatchObject({ code: 'CORRUPT' });
      expect(fs.readFileSync(store.file)).toEqual(original);
    },
  );

  it.each([
    { tasks: [{ ...task(), status: 'completed' }] },
    { tasks: [task(), task()] },
    { tasks: [{ ...task(), agentId: 'unknown' }] },
    { events: [{ ...event(), taskId: 'missing' }] },
    { approvals: [approval()] },
    { agents: [{ id: 'andre', status: 'busy' }] },
    { tasks: [{ ...task(), createdAt: '2026-01-01T00:00:00.000Z' }] },
    { tasks: [{ ...task(), credentials: 'proibido' }] },
    { tasks: null },
    { unknown: [] },
  ])('rejects invalid writes atomically (%#)', async (changes) => {
    await store.initialize();
    const before = fs.readFileSync(store.file);
    await expect(store.commit(changes as unknown as StorageChanges, 1)).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(fs.readFileSync(store.file)).toEqual(before);
  });

  it.each([
    'Authorization: Bearer example-value',
    'api_key=example-value',
    'password=example-value',
    'token=example-value',
  ])('refuses common credential content before disk write (%#)', async (prompt) => {
    await store.initialize();
    await expect(store.commit({ tasks: [{ ...task(), prompt }] }, 1)).rejects.toMatchObject({
      code: 'INVALID',
    });
    expect(fs.readFileSync(store.file, 'utf8')).not.toContain('example-value');
    expect(fs.existsSync(store.file + '.pending')).toBe(false);
  });

  it('permits valid task and approval transitions and makes events and closed records immutable', async () => {
    await running();
    await store.commit(
      { tasks: [{ ...task(), status: 'approval' }], approvals: [approval()], events: [event()] },
      3,
    );
    await expect(
      store.commit({ tasks: [{ ...task(), status: 'completed' }] }, 4),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      store.commit(
        { approvals: [{ ...approval(), summary: 'Outro comando', status: 'accepted' }] },
        4,
      ),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      store.commit({ events: [{ ...event(), message: 'Reescrever' }] }, 4),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await store.commit(
      {
        approvals: [{ ...approval(), status: 'accepted' }],
        tasks: [{ ...task(), status: 'running' }],
      },
      4,
    );
    await store.commit({ tasks: [{ ...task(), status: 'completed', output: 'Concluída' }] }, 5);
    await expect(
      store.commit({ approvals: [{ ...approval(), status: 'declined' }] }, 6),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      store.commit({ tasks: [{ ...task(), status: 'running' }] }, 6),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      store.commit({ tasks: [{ ...task(), status: 'completed', output: 'Reescrever' }] }, 6),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('rejects accepting an unreviewable approval', async () => {
    await running();
    await store.commit({ approvals: [{ ...approval(), reviewable: false }] }, 3);
    await expect(
      store.commit({ approvals: [{ ...approval(), reviewable: false, status: 'accepted' }] }, 4),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('preserves the concurrency limit of one active task', async () => {
    await running();
    await store.commit({ tasks: [task('task-2')] }, 3);
    await expect(
      store.commit({ tasks: [{ ...task('task-2'), status: 'running' }] }, 4),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect((await store.read())?.data.tasks[1].status).toBe('created');
  });

  it('rejects size/count limits without trimming histories', async () => {
    const saved = await created();
    const before = fs.readFileSync(store.file);
    const smallRecord = new Md2Storage({ root, scope, limits: { maxRecordBytes: 512 } });
    await expect(
      smallRecord.commit(
        { tasks: [{ ...task(), status: 'running', output: 'x'.repeat(1024) }] },
        2,
      ),
    ).rejects.toMatchObject({ code: 'LIMIT' });
    const full = new Md2Storage({ root, scope, limits: { maxRecords: 23 } });
    await expect(full.commit({ events: [event()] }, 2)).rejects.toMatchObject({ code: 'LIMIT' });
    const smallFile = new Md2Storage({ root, scope, limits: { maxFileBytes: before.length + 10 } });
    await expect(
      smallFile.commit({ tasks: [{ ...task(), status: 'running', output: 'x'.repeat(100) }] }, 2),
    ).rejects.toMatchObject({ code: 'LIMIT' });
    expect(fs.readFileSync(store.file)).toEqual(before);
    expect(await store.read()).toEqual(saved);
  });

  it('reports expired retention candidates without deleting any history', async () => {
    await created();
    const saved = await store.commit(
      { tasks: [{ ...task(), status: 'interrupted' }], events: [event()] },
      2,
    );
    const before = fs.readFileSync(store.file);
    const now = new Date(Date.parse(saved.updatedAt) + 3 * 86400000);
    const shorter = new Md2Storage({ root, scope, limits: { retentionDays: 2 } });
    expect(await shorter.retentionCandidates(now)).toEqual({
      tasks: ['task-1'],
      events: ['event-1'],
      approvals: [],
    });
    expect(await store.retentionCandidates(now)).toEqual({ tasks: [], events: [], approvals: [] });
    expect(fs.readFileSync(store.file)).toEqual(before);
  });

  it('leaves legacy tasks.json byte-for-byte unchanged and only offers a migration preflight', async () => {
    fs.mkdirSync(path.dirname(store.legacyFile), { recursive: true });
    const legacy =
      '{ "tasks": [{"id":"old-task","prompt":"Histórico sensível"}], "approvals": [] }\n';
    fs.writeFileSync(store.legacyFile, legacy);
    expect(await store.inspectLegacy()).toEqual({
      exists: true,
      tasks: 1,
      approvals: 0,
      migrationRequired: true,
    });
    await created();
    expect(fs.readFileSync(store.legacyFile, 'utf8')).toBe(legacy);
    expect((await store.read())?.data.tasks.map((item) => item.id)).toEqual(['task-1']);
  });

  it('preserves the last committed snapshot on rename failure and explicitly recovers pending data', async () => {
    await created();
    const before = fs.readFileSync(store.file);
    const rename = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (String(from).endsWith('.pending')) throw new Error('Simulated rename failure');
      return rename(from, to);
    });
    await expect(store.commit({ events: [event()] }, 2)).rejects.toThrow('Simulated');
    vi.mocked(fs.renameSync).mockReset();
    expect(fs.readFileSync(store.file)).toEqual(before);
    const restarted = new Md2Storage({ root, scope });
    expect(await restarted.inspectRecovery()).toEqual({
      current: 'valid',
      backup: 'valid',
      pending: 'valid',
    });
    await expect(restarted.commit({}, 2)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await restarted.recover('pending')).data.events).toHaveLength(1);
    expect((await restarted.read())?.revision).toBe(4);
    expect(
      fs.readdirSync(path.dirname(store.file)).filter((name) => name.includes('.preserved-'))
        .length,
    ).toBe(2);
  });

  it('recovers an interrupted first write only on explicit request', async () => {
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw new Error('Simulated sync failure');
    });
    await expect(store.initialize()).rejects.toThrow('Simulated');
    expect(await store.inspectRecovery()).toEqual({
      current: 'missing',
      backup: 'missing',
      pending: 'valid',
    });
    await expect(store.read()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await store.recover('pending')).revision).toBe(2);
    expect((await store.read())?.data.agents).toHaveLength(22);
  });

  it('requires explicit backup restoration and archives corrupt primary bytes', async () => {
    await created();
    fs.writeFileSync(store.file, 'corrupt primary');
    await expect(store.read()).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(await store.inspectRecovery()).toEqual({
      current: 'invalid',
      backup: 'valid',
      pending: 'missing',
    });
    const restored = await store.recover('backup');
    expect(restored.revision).toBe(3);
    await expect(store.commit({}, 2)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await store.read()).toEqual(restored);
    const preserved = fs
      .readdirSync(path.dirname(store.file))
      .find((name) => name.includes('.preserved-'))!;
    expect(fs.readFileSync(path.join(path.dirname(store.file), preserved), 'utf8')).toBe(
      'corrupt primary',
    );
  });

  it('does not overwrite an invalid pending file and can archive it during explicit backup recovery', async () => {
    await created();
    fs.writeFileSync(store.file + '.pending', 'partial pending');
    await expect(store.commit({}, 2)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await expect(store.recover('pending')).rejects.toMatchObject({ code: 'CORRUPT' });
    expect(fs.readFileSync(store.file + '.pending', 'utf8')).toBe('partial pending');
    await store.recover('backup');
    expect(
      fs.readdirSync(path.dirname(store.file)).some((name) => name.includes('.pending-resolved-')),
    ).toBe(true);
  });

  it('rejects symlinked storage directories instead of crossing scope boundaries', async () => {
    const outside = fs.mkdtempSync(path.join(tmpdir(), 'md2-outside-'));
    try {
      fs.symlinkSync(outside, path.join(root, '.md2-office'), 'junction');
      expect(() => new Md2Storage({ root, scope })).toThrow('inseguro');
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      if (fs.existsSync(path.join(root, '.md2-office')))
        fs.unlinkSync(path.join(root, '.md2-office'));
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects coerced non-string states even when the checksum is valid', async () => {
    const saved = await created();
    Object.assign(saved.data.tasks[0], { status: ['created'] });
    rewrite(saved);
    await expect(store.read()).rejects.toMatchObject({ code: 'CORRUPT' });
  });

  it('does not initialize over a missing primary when a backup exists', async () => {
    await created();
    const archived = store.file + '.manual-archive';
    fs.renameSync(store.file, archived);
    await expect(store.read()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await expect(store.initialize()).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(fs.existsSync(store.file)).toBe(false);
    expect((await store.recover('backup')).revision).toBe(3);
    expect(fs.existsSync(archived)).toBe(true);
  });

  it('refuses a stale pending revision and preserves every candidate', async () => {
    const current = await created();
    fs.writeFileSync(store.file + '.pending', JSON.stringify(current));
    await expect(store.recover('pending')).rejects.toMatchObject({ code: 'INVALID' });
    expect(await store.inspectRecovery()).toEqual({
      current: 'valid',
      backup: 'valid',
      pending: 'valid',
    });
    expect(await store.read()).toEqual(current);
  });

  it('keeps primary data when recovery publication fails', async () => {
    await created();
    const original = fs.readFileSync(store.file);
    const rename = vi.mocked(fs.renameSync).getMockImplementation()!;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
      if (String(from).includes('.recovery-')) throw new Error('Simulated recovery failure');
      return rename(from, to);
    });
    await expect(store.recover('backup')).rejects.toThrow('Simulated recovery');
    expect(fs.readFileSync(store.file)).toEqual(original);
    expect((await store.inspectRecovery()).backup).toBe('valid');
  });
});
