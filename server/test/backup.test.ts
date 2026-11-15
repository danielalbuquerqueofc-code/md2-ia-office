import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupService, restoreSnapshot } from '../src/backup.js';
import { plan, setup } from './helpers.js';

let t: ReturnType<typeof setup>;
let backupDir: string;
beforeEach(async () => {
  t = setup();
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-bk-'));
  t.runtime.plans.push(plan([{ chave: 'doc', agente: 'rafael' }]));
  t.runtime.agentImpl = async (o) => {
    fs.writeFileSync(path.join(o.cwd, 'entregas/proposta.html'), '<p>proposta</p>');
    await o.handlers.registrarEntregavel({ caminho: 'entregas/proposta.html', nome: 'Proposta', categoria: 'proposta' });
    return { text: 'ok', costUsd: 0.01 };
  };
  t.engine.submit({ text: 'Gere a proposta' });
  await t.engine.whenIdle();
});
afterEach(() => { t.cleanup(); fs.rmSync(backupDir, { recursive: true, force: true }); });

describe('backup e restauração', () => {
  it('cria snapshot consistente e verificado, com arquivos de entregáveis espelhados', async () => {
    const svc = new BackupService(t.services.db, t.dataDir, backupDir, 14);
    const snap = await svc.create();
    expect(snap.manifest).toMatchObject({ format: 'md2-backup-v1', verified: true, db: { integrity: 'ok' } });
    expect(snap.manifest.counts.deliverables).toBe(1);
    expect(svc.verify(snap).checked.deliverableFiles).toBe(1);
    expect(snap.manifest.files.copied).toBeGreaterThan(0);
    const again = await svc.create();
    expect(again.manifest.files.copied).toBe(0); // espelho incremental: nada mudou, nada é copiado
    const copy = new DatabaseSync(path.join(snap.dir, 'md2.sqlite'), { readOnly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM executions').get() as { n: number }).n).toBe(1);
    copy.close();
  });

  it('detecta banco alterado e arquivo de entregável ausente', async () => {
    const svc = new BackupService(t.services.db, t.dataDir, backupDir, 14);
    const snap = await svc.create();
    fs.appendFileSync(path.join(snap.dir, 'md2.sqlite'), 'lixo');
    const v1 = svc.verify(snap);
    expect(v1.ok).toBe(false);
    expect(v1.problems.join()).toMatch(/hash do banco/);
    const snap2 = await svc.create();
    fs.rmSync(path.join(backupDir, 'files', 'deliverables'), { recursive: true });
    expect(svc.verify(snap2).problems.join()).toMatch(/ausente no espelho/);
  });

  it('retenção mantém os mais recentes e nunca fica sem backup', async () => {
    const svc = new BackupService(t.services.db, t.dataDir, backupDir, 2);
    for (let i = 0; i < 4; i++) await svc.create();
    expect(svc.list()).toHaveLength(2);
    const one = new BackupService(t.services.db, t.dataDir, fs.mkdtempSync(path.join(os.tmpdir(), 'md2-bk1-')), 1);
    await one.create();
    expect(one.prune()).toEqual([]);
    expect(one.list()).toHaveLength(1);
  });

  it('restaura em diretório novo e recusa sobrescrever dados', async () => {
    const svc = new BackupService(t.services.db, t.dataDir, backupDir, 14);
    const snap = await svc.create();
    const target = path.join(backupDir, 'restaurado');
    const r = restoreSnapshot(snap.dir, target);
    expect(r.files).toBeGreaterThan(0);
    const db = new DatabaseSync(path.join(target, 'md2.sqlite'), { readOnly: true });
    expect((db.prepare('SELECT name FROM deliverables').get() as { name: string }).name).toBe('Proposta');
    const v = db.prepare('SELECT rel_path, entry FROM deliverable_versions').get() as { rel_path: string; entry: string };
    db.close();
    expect(fs.readFileSync(path.join(target, v.rel_path, v.entry), 'utf8')).toBe('<p>proposta</p>');
    expect(() => restoreSnapshot(snap.dir, target)).toThrow(/nunca sobrescreve/);
    expect(() => restoreSnapshot(snap.dir, t.dataDir)).toThrow(/nunca sobrescreve/);
  });
});
