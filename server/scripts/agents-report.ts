/** Gera docs/AGENTES.md: auditoria de cada um dos 22 agentes a partir dos registros reais. */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { AgentRegistry } from '../src/registry/agents.js';
import { KnowledgeEngine } from '../src/registry/knowledge.js';
import { SkillRegistry } from '../src/registry/skills.js';
import { CLASSIFICATION_LABEL, ToolRegistry } from '../src/registry/tools.js';

const root = process.cwd();
const agents = new AgentRegistry(root), knowledge = new KnowledgeEngine(root), skills = new SkillRegistry(root);
const tools = new ToolRegistry(loadConfig({}, root));
const NAME: Record<string, string> = { especificacao: 'Confirmado pela especificação', especificacao_condicional: 'Condicional ("caso esse seja o nome cadastrado")', provisorio: '**Provisório**' };
const ROLE: Record<string, string> = { especificacao: 'Especificação', definido_na_reformulacao: 'Definida na reformulação' };

const rows: string[] = [];
const gaps: string[] = [];
for (const a of agents.list()) {
  const d = agents.department(a.department);
  const docs = knowledge.docs.filter((k) => d.knowledge.includes(k.department));
  const own = docs.filter((k) => k.department === a.department).length;
  const sk = a.skills.map((id) => skills.get(id));
  const missing = a.skills.filter((_id, i) => !sk[i]);
  const notOwner = sk.filter((s) => s && !s.owners.includes(a.id)).map((s) => s!.id);
  const ts = a.tools.map((id) => tools.get(id)!);
  const usable = ts.filter((t) => t.status === 'disponivel').map((t) => t.name);
  const blocked = ts.filter((t) => t.status !== 'disponivel').map((t) => `${t.name} (${CLASSIFICATION_LABEL[t.classification].toLowerCase()})`);
  const limits = a.limits.length + d.limits.length + agents.file.common.limits.length;
  if (missing.length) gaps.push(`${a.name}: skills inexistentes ${missing.join(', ')}`);
  if (notOwner.length) gaps.push(`${a.name}: atribuído a ${notOwner.join(', ')}, mas não consta como responsável no SKILL.md`);
  if (!own) gaps.push(`${a.name} (${d.name}): nenhum documento de conhecimento próprio do departamento; usa bibliotecas de apoio (${d.knowledge.join(', ')}).`);
  if (blocked.length) gaps.push(`${a.name}: ferramentas autorizadas ainda não utilizáveis: ${blocked.join('; ')}.`);
  if (a.nameStatus === 'provisorio') gaps.push(`${a.name}: nome provisório; função ${a.role.toLowerCase()} definida na reformulação.`);
  rows.push(`### ${a.name} — ${a.role}

| Item | Situação |
|---|---|
| Departamento | ${d.name} |
| Nome | ${NAME[a.nameStatus]} |
| Função | ${ROLE[a.roleStatus]} |
| Responsabilidade principal | ${a.specialty} |
| Conhecimento disponível | ${docs.length} documentos (${own} do próprio departamento): ${docs.map((k) => k.id).join(', ')} |
| Skills | ${a.skills.map((id) => `\`${id}\``).join(', ')}${missing.length ? ` — **inexistentes: ${missing.join(', ')}**` : ''} |
| Ferramentas utilizáveis | ${usable.join(', ') || 'nenhuma'} |
| Ferramentas pendentes | ${blocked.join('; ') || '—'} |
| Limites de atuação | ${limits} regras (${a.limits.length} próprias, ${d.limits.length} do departamento, ${agents.file.common.limits.length} comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | ${a.quality.join(' · ')} |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via \`registrar_entregavel\` |
`);
}

const counts = agents.list().reduce<Record<string, number>>((m, a) => ({ ...m, [a.nameStatus]: (m[a.nameStatus] ?? 0) + 1 }), {});
const md = `# Auditoria dos 22 agentes

Gerado por \`npm run docs:agents\` a partir de \`agents/registry.json\`, \`skills/\`, \`knowledge/\` e do Tool Registry. Não editar à mão.

Alfred é o orquestrador central (${agents.file.alfred.role}) e **não** faz parte dos 22.

## Origem das identidades

| Situação do nome | Quantidade |
|---|---|
| Confirmado pela especificação | ${counts.especificacao ?? 0} |
| Condicional (Patrícia) | ${counts.especificacao_condicional ?? 0} |
| Provisório | ${counts.provisorio ?? 0} |

Nomes provisórios: ${agents.list().filter((a) => a.nameStatus === 'provisorio').map((a) => `${a.name} (${agents.department(a.department).name})`).join(', ')}.

O cadastro original dos agentes não foi encontrado no repositório (ver \`docs/DIAGNOSTICO.md\`). Nenhuma identidade provisória deve ser tratada como original. Para corrigir, edite \`agents/registry.json\` e mude \`nameStatus\`/\`roleStatus\`.

## Lacunas encontradas

${gaps.map((g) => `- ${g}`).join('\n')}

## Ficha por agente

${rows.join('\n')}`;
fs.writeFileSync(path.join(root, 'docs', 'AGENTES.md'), md);
console.log(`docs/AGENTES.md gerado: ${agents.list().length} agentes, ${gaps.length} lacunas.`);
