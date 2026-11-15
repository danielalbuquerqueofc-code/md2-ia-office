import fs from 'node:fs';
import path from 'node:path';
import { asList, asText, parseFrontmatter } from './frontmatter.js';

export interface KnowledgeDoc {
  id: string; department: string; title: string; summary: string; tags: string[]; updated: string; body: string;
}
export interface KnowledgeChunk { docId: string; department: string; title: string; heading: string; text: string; terms: Map<string, number>; length: number }
export interface KnowledgeHit { docId: string; department: string; title: string; heading: string; text: string; score: number }

const STOP = new Set('a o e de da do das dos em no na nos nas um uma para por com sem que se os as ao aos à às ou como mais menos é ser são foi the of and to in'.split(' '));

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => (t.length > 5 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/**
 * Knowledge Engine: bibliotecas em Markdown por departamento, recuperação contextual BM25 por seção.
 * Sem embeddings de propósito: o acervo é pequeno e curado; BM25 é determinístico, offline e sem custo.
 */
export class KnowledgeEngine {
  readonly docs: KnowledgeDoc[] = [];
  private chunks: KnowledgeChunk[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(rootDir: string) {
    const base = path.join(rootDir, 'knowledge');
    if (!fs.existsSync(base)) return;
    for (const dept of fs.readdirSync(base).sort()) {
      const dir = path.join(base, dept);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
        const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
        const doc: KnowledgeDoc = {
          id: `${dept}/${f.replace(/\.md$/, '')}`, department: dept,
          title: asText(meta.title) || f, summary: asText(meta.summary), tags: asList(meta.tags),
          updated: asText(meta.updated), body: body.trim(),
        };
        this.docs.push(doc);
        for (const section of doc.body.split(/\n(?=## )/)) {
          const heading = /^##\s+(.*)/.exec(section)?.[1] ?? doc.title;
          const tokens = tokenize(`${doc.title} ${doc.tags.join(' ')} ${section}`);
          const terms = new Map<string, number>();
          for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
          this.chunks.push({ docId: doc.id, department: dept, title: doc.title, heading, text: section.trim(), terms, length: tokens.length });
        }
      }
    }
    for (const c of this.chunks) for (const t of c.terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.chunks.reduce((s, c) => s + c.length, 0) / Math.max(1, this.chunks.length);
  }

  /** `boost`: ids de documentos do especialista; ganham 60% de peso na ordenação (sem excluir os demais do departamento). */
  search(query: string, opts: { departments?: string[]; limit?: number; boost?: string[] } = {}): KnowledgeHit[] {
    const q = [...new Set(tokenize(query))];
    const N = this.chunks.length;
    const k1 = 1.4, b = 0.75;
    return this.chunks
      .filter((c) => !opts.departments?.length || opts.departments.includes(c.department))
      .map((c) => {
        let score = 0;
        for (const t of q) {
          const tf = c.terms.get(t);
          if (!tf) continue;
          const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
          score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.length) / this.avgLen));
        }
        if (opts.boost?.includes(c.docId)) score *= 1.6;
        return { docId: c.docId, department: c.department, title: c.title, heading: c.heading, text: c.text, score };
      })
      .filter((h) => h.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, opts.limit ?? 5);
  }

  get(id: string) { return this.docs.find((d) => d.id === id); }

  /** Trechos prontos para compor o contexto de um agente, respeitando um teto de caracteres. */
  context(query: string, departments: string[], maxChars = 9000, boost: string[] = []): string {
    let out = '';
    for (const h of this.search(query, { departments, limit: 8, boost })) {
      const block = `### [${h.docId}] ${h.title} — ${h.heading}\n${h.text}\n\n`;
      if (out.length + block.length > maxChars) break;
      out += block;
    }
    return out.trim();
  }
}
