import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import type { Db } from './db.js';

/**
 * Backup do MD2 IA Office.
 *
 * Cada snapshot fica em `<backupDir>/snapshots/<AAAAMMDD-HHMMSS>/`:
 *   - `md2.sqlite`: cópia online e consistente do banco (API de backup do SQLite);
 *   - `manifest.json`: data, hash SHA-256, tamanho, resultado do integrity_check e contagens.
 * Arquivos (entregáveis, uploads, workspaces) são espelhados em `<backupDir>/files/` de forma
 * incremental e aditiva: o backup nunca apaga arquivos espelhados. Entregáveis são imutáveis por versão.
 *
 * Retenção: mantém os `keep` snapshots mais recentes. Nunca apaga quando há 1 ou menos, nunca apaga o
 * snapshot verificado mais recente e só apaga diretórios que têm manifest criado por este módulo.
 */

export interface Manifest {
  format: 'md2-backup-v1';
  createdAt: string;
  db: { file: string; sha256: string; bytes: number; integrity: string };
  counts: Record<string, number>;
  files: { mirrored: number; copied: number; bytesCopied: number };
  verified: boolean;
}
export interface SnapshotInfo { name: string; dir: string; manifest: Manifest }
export interface VerifyResult { ok: boolean; problems: string[]; checked: { dbHash: boolean; integrity: string; deliverableFiles: number } }

const FILE_DIRS = ['deliverables', 'uploads', 'workspaces'];
const SKIP = new Set(['node_modules', '.git', '.cache', '.tmp']);

export const sha256File = (file: string) => {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
};

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Copia para o espelho só o que não existe ou mudou (tamanho/mtime). Nunca remove nada do espelho. */
function mirror(src: string, dest: string, acc: { mirrored: number; copied: number; bytesCopied: number }) {
  if (!fs.existsSync(src)) return;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP.has(ent.name) || ent.isSymbolicLink()) continue;
    const s = path.join(src, ent.name), d = path.join(dest, ent.name);
    if (ent.isDirectory()) { mirror(s, d, acc); continue; }
    if (!ent.isFile()) continue;
    acc.mirrored++;
    const st = fs.statSync(s);
    const dt = fs.existsSync(d) ? fs.statSync(d) : null;
    if (dt && dt.size === st.size && dt.mtimeMs >= st.mtimeMs) continue;
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    fs.utimesSync(d, st.atime, st.mtime);
    acc.copied++;
    acc.bytesCopied += st.size;
  }
}

export class BackupService {
  constructor(private db: Db, private dataDir: string, private backupDir: string, private keep = 14) {}

  get snapshotsDir() { return path.join(this.backupDir, 'snapshots'); }
  get filesDir() { return path.join(this.backupDir, 'files'); }

  list(): SnapshotInfo[] {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    return fs.readdirSync(this.snapshotsDir)
      .filter((n) => /^\d{8}-\d{6}(-\d+)?$/.test(n))
      .map((name) => {
        const dir = path.join(this.snapshotsDir, name);
        try { return { name, dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest }; } catch { return null; }
      })
      .filter((x): x is SnapshotInfo => !!x && x.manifest.format === 'md2-backup-v1')
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  latest() { return this.list()[0]; }

  /** Cria um snapshot verificado. Lança erro (sem apagar nada) se a verificação falhar. */
  async create(): Promise<SnapshotInfo> {
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
    let name = stamp();
    for (let i = 2; fs.existsSync(path.join(this.snapshotsDir, name)); i++) name = `${stamp()}-${i}`;
    const dir = path.join(this.snapshotsDir, name);
    const tmp = `${dir}.parcial`;
    fs.mkdirSync(tmp, { recursive: true });
    const dbFile = path.join(tmp, 'md2.sqlite');
    await sqliteBackup(this.db.sql, dbFile);

    const copy = new DatabaseSync(dbFile, { readOnly: true });
    let integrity: string, counts: Record<string, number>;
    try {
      integrity = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      counts = {};
      for (const t of ['conversations', 'messages', 'executions', 'tasks', 'deliverables', 'deliverable_versions', 'approvals', 'audit']) {
        counts[t] = (copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      }
    } finally {
      copy.close();
    }
    const files = { mirrored: 0, copied: 0, bytesCopied: 0 };
    for (const sub of FILE_DIRS) mirror(path.join(this.dataDir, sub), path.join(this.filesDir, sub), files);

    const manifest: Manifest = {
      format: 'md2-backup-v1', createdAt: new Date().toISOString(),
      db: { file: 'md2.sqlite', sha256: sha256File(dbFile), bytes: fs.statSync(dbFile).size, integrity },
      counts, files, verified: false,
    };
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, dir); // snapshot só aparece completo
    const info = { name, dir, manifest };
    const v = this.verify(info);
    manifest.verified = v.ok;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    if (!v.ok) throw new Error(`Backup criado em ${dir}, mas a verificação falhou: ${v.problems.join('; ')}`);
    this.prune();
    return info;
  }

  /** Confere hash, integridade do banco copiado e presença dos arquivos de todas as versões de entregáveis. */
  verify(snap: SnapshotInfo): VerifyResult {
    const problems: string[] = [];
    const dbFile = path.join(snap.dir, snap.manifest.db.file);
    let dbHash = false, integrity = 'não verificado', deliverableFiles = 0;
    if (!fs.existsSync(dbFile)) problems.push('arquivo do banco ausente');
    else {
      dbHash = sha256File(dbFile) === snap.manifest.db.sha256;
      if (!dbHash) problems.push('hash do banco não confere (arquivo alterado ou corrompido)');
      try {
        const copy = new DatabaseSync(dbFile, { readOnly: true });
        try {
          integrity = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
          if (integrity !== 'ok') problems.push(`integrity_check: ${integrity}`);
          const versions = copy.prepare('SELECT rel_path, entry FROM deliverable_versions').all() as Array<{ rel_path: string; entry: string }>;
          for (const v of versions) {
            const f = path.join(this.filesDir, v.rel_path, v.entry);
            if (fs.existsSync(f)) deliverableFiles++;
            else problems.push(`arquivo de entregável ausente no espelho: ${path.join(v.rel_path, v.entry)}`);
          }
        } finally {
          copy.close();
        }
      } catch (e) {
        problems.push(`banco ilegível: ${(e as Error).message}`);
      }
    }
    return { ok: problems.length === 0, problems, checked: { dbHash, integrity, deliverableFiles } };
  }

  /** Retenção segura. Retorna os snapshots removidos. */
  prune(): string[] {
    const all = this.list();
    if (all.length <= 1) return [];
    const newestVerified = all.find((s) => s.manifest.verified)?.name;
    const removed: string[] = [];
    const keep = Math.max(2, this.keep); // sempre sobram pelo menos 2 snapshots
    for (const s of all.slice(keep)) {
      if (s.name === newestVerified) continue;
      fs.rmSync(s.dir, { recursive: true, force: true });
      removed.push(s.name);
    }
    return removed;
  }
}

/**
 * Restaura um snapshot para um diretório de dados NOVO. Recusa destino existente e não vazio:
 * a restauração nunca sobrescreve dados atuais. Depois, inicie com MD2_DATA_DIR=<destino>.
 */
export function restoreSnapshot(snapshotDir: string, target: string): { files: number } {
  const backupDir = path.resolve(snapshotDir, '..', '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.format !== 'md2-backup-v1') throw new Error('Diretório não é um snapshot do MD2.');
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`Destino ${target} já existe e não está vazio. A restauração nunca sobrescreve dados.`);
  if (sha256File(path.join(snapshotDir, manifest.db.file)) !== manifest.db.sha256) throw new Error('Hash do banco do snapshot não confere. Escolha outro snapshot.');
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(snapshotDir, manifest.db.file), path.join(target, 'md2.sqlite'));
  const acc = { mirrored: 0, copied: 0, bytesCopied: 0 };
  for (const sub of FILE_DIRS) mirror(path.join(backupDir, 'files', sub), path.join(target, sub), acc);
  return { files: acc.copied };
}
