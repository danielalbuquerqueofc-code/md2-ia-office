import fs from 'node:fs';
import path from 'node:path';
import { asList, asText, parseFrontmatter } from './frontmatter.js';

export interface Skill {
  id: string; name: string; department: string; description: string; owners: string[]; triggers: string[];
  inputs: string[]; tools: string[]; outputs: string[]; body: string; dir: string; resources: string[];
}
const REQUIRED_SECTIONS = ['Etapas', 'Validação', 'Erros', 'Limites'];

/** Skill Registry: cada skill é um diretório com SKILL.md (formato compatível com Claude Code) e arquivos de apoio. */
export class SkillRegistry {
  readonly skills: Skill[] = [];
  readonly problems: string[] = [];
  constructor(rootDir: string) {
    const base = path.join(rootDir, 'skills');
    if (!fs.existsSync(base)) return;
    for (const dept of fs.readdirSync(base).sort()) {
      const deptDir = path.join(base, dept);
      if (!fs.statSync(deptDir).isDirectory()) continue;
      for (const slug of fs.readdirSync(deptDir).sort()) {
        const dir = path.join(deptDir, slug);
        const file = path.join(dir, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
        const resources: string[] = [];
        for (const sub of ['references', 'templates', 'scripts']) {
          const p = path.join(dir, sub);
          if (fs.existsSync(p)) for (const f of fs.readdirSync(p)) resources.push(`${sub}/${f}`);
        }
        const skill: Skill = {
          id: asText(meta.name) || slug, name: asText(meta.title) || slug, department: dept,
          description: asText(meta.description), owners: asList(meta.owners), triggers: asList(meta.triggers),
          inputs: asList(meta.inputs), tools: asList(meta.tools), outputs: asList(meta.outputs),
          body: body.trim(), dir, resources,
        };
        if (skill.id !== slug) this.problems.push(`${dept}/${slug}: "name" (${skill.id}) difere do diretório`);
        if (!skill.description) this.problems.push(`${dept}/${slug}: sem description`);
        for (const s of REQUIRED_SECTIONS) if (!new RegExp(`^## ${s}`, 'm').test(body)) this.problems.push(`${dept}/${slug}: seção "## ${s}" ausente`);
        this.skills.push(skill);
      }
    }
  }
  get(id: string) { return this.skills.find((s) => s.id === id); }
  catalog(): string {
    return this.skills.map((s) => `- ${s.id} (${s.owners.join(', ')}): ${s.description}`).join('\n');
  }
  /** Conteúdo completo injetado no contexto do agente quando a skill é atribuída à tarefa. */
  render(id: string): string {
    const s = this.get(id);
    if (!s) return '';
    const res = s.resources.length
      ? `\n\nArquivos de apoio (leia com a ferramenta Read quando precisar): ${s.resources.map((r) => path.join(s.dir, r)).join(', ')}`
      : '';
    return `# Skill: ${s.name} (${s.id})\n${s.description}\n\n${s.body}${res}`;
  }
}
