import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.js';
import { newId, now } from '../db.js';

export const CATEGORIES = ['site', 'video', 'imagem', 'documento', 'proposta', 'relatorio', 'campanha', 'projeto', 'outro'] as const;
const KIND_BY_EXT: Record<string, string> = {
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.png': 'imagem', '.jpg': 'imagem', '.jpeg': 'imagem', '.webp': 'imagem', '.gif': 'imagem', '.svg': 'imagem',
  '.pdf': 'pdf', '.html': 'pagina', '.htm': 'pagina',
  '.md': 'texto', '.txt': 'texto', '.csv': 'texto', '.json': 'texto', '.srt': 'texto',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio',
};
const MAX_BYTES = 1024 ** 3;
const SKIP = new Set(['node_modules', '.git', '.cache']);

export interface DeliverableRow {
  id: string; conversation_id: string; execution_id: string | null; task_id: string | null; agent_id: string | null;
  name: string; category: string; client: string | null; status: string; notes: string | null; decision_note: string | null;
  created_at: string; updated_at: string;
}
export interface RegisterInput {
  conversationId: string; executionId: string; taskId: string | null; agentId: string;
  workspace: string; caminho: string; nome: string; categoria: string; cliente?: string; observacoes?: string;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : e.isFile() ? fs.statSync(p).size : 0;
  }
  return total;
}

/** Central de Entregáveis: cada registro gera um snapshot imutável versionado fora do workspace. */
export class Deliverables {
  constructor(private db: Db, private dataDir: string) {}

  register(input: RegisterInput) {
    const src = path.resolve(input.workspace, input.caminho);
    const outside = (p: string, base: string) => { const r = path.relative(base, p); return r.startsWith('..') || path.isAbsolute(r); };
    if (outside(src, input.workspace)) throw new Error('O caminho precisa estar dentro do workspace.');
    if (!fs.existsSync(src)) throw new Error(`Arquivo ou pasta não encontrado: ${input.caminho}`);
    // Resolve links simbólicos em qualquer ponto do caminho: "pasta -> /etc" + "pasta/passwd" é recusado.
    if (outside(fs.realpathSync.native(src), fs.realpathSync.native(input.workspace))) throw new Error('O caminho aponta para fora do workspace (link simbólico).');
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) throw new Error('Links simbólicos não podem ser registrados.');
    const name = input.nome.trim().slice(0, 120);
    if (!name) throw new Error('Informe o nome do entregável.');
    const category = (CATEGORIES as readonly string[]).includes(input.categoria) ? input.categoria : 'outro';

    let kind: string, entry: string, size: number;
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('Pastas só podem ser registradas como site: falta index.html na raiz da pasta.');
      kind = 'site'; entry = 'index.html'; size = dirSize(src);
    } else {
      kind = KIND_BY_EXT[path.extname(src).toLowerCase()] ?? 'arquivo';
      entry = path.basename(src); size = stat.size;
    }
    if (size === 0) throw new Error('O arquivo está vazio; nada foi registrado.');
    if (size > MAX_BYTES) throw new Error('Entregável acima de 1 GB.');

    const ts = now();
    let d = this.db.get<{ id: string }>('SELECT id FROM deliverables WHERE conversation_id = :c AND name = :n', { c: input.conversationId, n: name });
    if (!d) {
      d = { id: newId() };
      this.db.insert('deliverables', {
        id: d.id, conversation_id: input.conversationId, execution_id: input.executionId, task_id: input.taskId, agent_id: input.agentId,
        name, category, client: input.cliente ?? null, status: 'para_revisao', notes: input.observacoes ?? null, created_at: ts, updated_at: ts,
      });
    } else {
      this.db.update('deliverables', d.id, {
        execution_id: input.executionId, task_id: input.taskId, agent_id: input.agentId, category, status: 'para_revisao',
        notes: input.observacoes ?? null, updated_at: ts, ...(input.cliente ? { client: input.cliente } : {}),
      });
    }
    const version = (this.db.get<{ v: number }>('SELECT COALESCE(MAX(version),0) AS v FROM deliverable_versions WHERE deliverable_id = :d', { d: d.id })?.v ?? 0) + 1;
    const relPath = path.join('deliverables', d.id, `v${version}`);
    const dest = path.join(this.dataDir, relPath);
    fs.mkdirSync(dest, { recursive: true });
    if (kind === 'site') fs.cpSync(src, dest, { recursive: true, filter: (s) => !SKIP.has(path.basename(s)) && !fs.lstatSync(s).isSymbolicLink() });
    else fs.copyFileSync(src, path.join(dest, entry));
    this.db.insert('deliverable_versions', {
      id: newId(), deliverable_id: d.id, version, rel_path: relPath, entry, kind, size,
      execution_id: input.executionId, agent_id: input.agentId, created_at: ts,
    });
    return { id: d.id, name, version, kind, category };
  }

  list(filter: { conversationId?: string; executionId?: string } = {}) {
    const rows = this.db.all<DeliverableRow>(
      `SELECT * FROM deliverables WHERE (:c IS NULL OR conversation_id = :c) AND (:e IS NULL OR execution_id = :e) ORDER BY updated_at DESC`,
      { c: filter.conversationId ?? null, e: filter.executionId ?? null },
    );
    return rows.map((r) => ({
      ...r,
      versions: this.db
        .all<{ version: number; entry: string; kind: string; size: number; created_at: string; agent_id: string }>(
          'SELECT version, entry, kind, size, created_at, agent_id FROM deliverable_versions WHERE deliverable_id = :d ORDER BY version DESC', { d: r.id })
        .map((v) => ({ ...v, url: `/files/deliverables/${r.id}/v${v.version}/${encodeURIComponent(v.entry)}` })),
    }));
  }
}
