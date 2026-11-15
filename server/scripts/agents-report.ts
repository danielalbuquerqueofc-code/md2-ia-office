/**
 * Gera docs/MATRIZ_DE_COMPETENCIAS.md e docs/AGENTES.md a partir dos registros reais
 * (agents/registry.json, skills/, knowledge/ e Tool Registry). Não editar os arquivos gerados à mão.
 * Uso: npm run docs:agents
 */
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
const LEVEL = { consultivo: 'Consultivo', producao: 'Produção', execucao_tecnica: 'Execução técnica' } as const;
const LEVEL_DESC = {
  consultivo: 'analisa, recomenda e escreve documentos; não executa comandos',
  producao: 'cria arquivos de entrega no workspace; não executa comandos',
  execucao_tecnica: 'executa comandos no workspace isolado para construir e testar',
};
const list = agents.list();
const li = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
const toolName = (id: string) => tools.get(id)?.name ?? id;
const toolState = (id: string) => { const t = tools.get(id)!; return t.status === 'disponivel' ? '' : ` *(${CLASSIFICATION_LABEL[t.classification].toLowerCase()})*`; };

const cards = list.map((a) => {
  const d = agents.department(a.department);
  const dels = a.requestOthersWhen.map((r) => `${agents.get(r.agent)!.name}: ${r.when}`);
  return `### ${a.name} — ${a.role}

| Campo | Conteúdo |
|---|---|
| **Departamento** | ${d.name} |
| **Cargo** | ${a.role} *(confirmado no cadastro original)* |
| **Capacidades originais** | ${a.originalCapabilities.map((c) => `\`${c}\``).join(', ')} |
| **Nível de autonomia** | ${LEVEL[a.autonomy.level]}: ${LEVEL_DESC[a.autonomy.level]} |
| **Skills** | ${a.skills.map((s) => `\`${s}\``).join(', ')} |
| **Conhecimentos especializados** | ${a.knowledge.map((k) => `\`${k}\``).join(', ')} |
| **Ferramentas permitidas** | ${a.tools.map((t) => toolName(t) + toolState(t)).join(', ')} |
| **Ferramentas proibidas** | ${a.toolsForbidden.map(toolName).join(', ')} |

**Responsabilidade principal.** ${a.specialty}

**Responsabilidades secundárias.**
${li(a.secondaryResponsibilities)}

**Limites de autonomia.**
- Pode: ${a.autonomy.can.join('; ')}.
- Não pode: ${a.autonomy.cannot.join('; ')}.
- Exige aprovação humana: ${a.autonomy.needsApproval.length ? a.autonomy.needsApproval.join(', ') : 'nenhuma ação externa; o que produz é rascunho até a sua aprovação'}.

**Quando Alfred lhe entrega tarefas.**
${li(a.receiveWhen)}

**Quando pede outro agente** (sempre por Alfred, em "Pedidos a Alfred"; não aciona ninguém diretamente).
${li(dels)}

**Como entrega.** ${a.delivery.format} Arquivos típicos: ${a.delivery.typical.map((t) => `\`${t}\``).join(', ')}.

**Critérios objetivos de qualidade.**
${li(a.quality)}
${a.toolNotes.length ? `\n**Notas sobre ferramentas.**\n${li(a.toolNotes)}\n` : ''}${a.openQuestions.length ? `\n**PENDENTE DE CONFIRMAÇÃO.**\n${li(a.openQuestions)}\n` : ''}`;
});

const toolIds = tools.tools.map((t) => t.id);
const toolHeader = `| Agente | ${toolIds.map((t) => toolName(t)).join(' | ')} |\n|---|${toolIds.map(() => ':-:').join('|')}|`;
const toolRows = list.map((a) => `| ${a.name} | ${toolIds.map((t) => (a.tools.includes(t) ? (tools.get(t)!.status === 'disponivel' ? '✓' : '○') : '—')).join(' | ')} |`);

const skillRows = skills.skills.map((s) => `| \`${s.id}\` | ${s.department} | ${s.owners.map((o) => agents.get(o)!.name).join(', ')} | ${s.description.slice(0, 110)}${s.description.length > 110 ? '…' : ''} |`);

const summary = list.map((a) => `| ${a.name} | ${agents.department(a.department).name} | ${a.role} | ${LEVEL[a.autonomy.level]} | ${a.skills.join(', ')} |`);

const matriz = `# Matriz de competências dos 22 agentes

Gerada por \`npm run docs:agents\` a partir de \`agents/registry.json\`, \`skills/\`, \`knowledge/\` e do Tool Registry. **Não editar à mão.**

## Como ler esta matriz

| Camada | Situação |
|---|---|
| **Identidade** (nome, departamento, cargo, descrição e capacidades originais) | **Confirmada** no cadastro original (commit \`d4e3933\`). Um teste automatizado falha se divergir. Ver [AGENTES_ORIGINAIS_E_CONFIRMADOS.md](AGENTES_ORIGINAIS_E_CONFIRMADOS.md). |
| **Competências** (tudo o mais nesta página) | **PENDENTE DE CONFIRMAÇÃO.** Proposta da reformulação; não consta no cadastro original e nunca foi aprovada. O cadastro original dizia só "elabora, planeja, analisa, revisa". |

Alfred é o orquestrador central e **não** é um dos 22. Os agentes não falam com o usuário nem entre si: pedem a Alfred, que decide.

## Visão geral

| Agente | Departamento | Cargo original | Autonomia | Skills |
|---|---|---|---|---|
${summary.join('\n')}

Níveis: **Consultivo** (analisa e escreve; sem comandos), **Produção** (cria arquivos de entrega; sem comandos), **Execução técnica** (roda comandos dentro do sandbox do workspace; nada sai dele).

## Ferramentas por agente

✓ disponível e usável · ○ autorizada mas a integração não está conectada (não é usada) · — proibida.
Só os 6 agentes de **Execução técnica** recebem o shell; a ferramenta "FFmpeg" e a "Transcrição" também passam pelo Bash, então um agente com elas tem o shell completo (dentro do sandbox).

${toolHeader}
${toolRows.join('\n')}

Ações que agem no mundo externo (publicar, enviar mensagem, gastar, excluir) não são concedidas a nenhum agente: todos preparam e pedem aprovação com \`solicitar_aprovacao\`.

## Skills e responsáveis

| Skill | Área | Responsáveis | Para que serve |
|---|---|---|---|
${skillRows.join('\n')}

Todo agente tem pelo menos uma skill que só ele possui (testado), e nenhuma skill existe sem responsável.

## Fichas

${cards.join('\n')}
`;
fs.writeFileSync(path.join(root, 'docs', 'MATRIZ_DE_COMPETENCIAS.md'), matriz);

const gaps: string[] = [];
for (const a of list) {
  const pend = a.tools.map((t) => tools.get(t)!).filter((t) => t.status !== 'disponivel');
  if (pend.length) gaps.push(`${a.name}: ferramentas autorizadas ainda não utilizáveis: ${pend.map((t) => `${t.name} (${CLASSIFICATION_LABEL[t.classification].toLowerCase()})`).join('; ')}.`);
  for (const q of a.openQuestions) gaps.push(`${a.name}: **PENDENTE DE CONFIRMAÇÃO** — ${q}.`);
  const own = knowledge.docs.filter((k) => k.department === a.department).length;
  if (!own) gaps.push(`${a.name} (${agents.department(a.department).name}): nenhum documento de conhecimento do próprio departamento; usa ${agents.department(a.department).knowledge.join(', ')}.`);
}
const idx = `# Agentes — índice e lacunas

Gerado por \`npm run docs:agents\`. Detalhes: [MATRIZ_DE_COMPETENCIAS.md](MATRIZ_DE_COMPETENCIAS.md). Origem e evidência: [AGENTES_ORIGINAIS_E_CONFIRMADOS.md](AGENTES_ORIGINAIS_E_CONFIRMADOS.md).

Alfred (${agents.file.alfred.role}) é o orquestrador e não faz parte dos 22.

| Agente | Departamento | Cargo (confirmado) | Competências |
|---|---|---|---|
${list.map((a) => `| ${a.name} | ${agents.department(a.department).name} | ${a.role} | ${a.competenciesStatus === 'confirmado' ? 'confirmadas' : 'propostas, pendentes'} |`).join('\n')}

## Lacunas e pendências

${gaps.map((g) => `- ${g}`).join('\n')}
`;
fs.writeFileSync(path.join(root, 'docs', 'AGENTES.md'), idx);
console.log(`docs/MATRIZ_DE_COMPETENCIAS.md e docs/AGENTES.md gerados: ${list.length} agentes, ${skills.skills.length} skills, ${gaps.length} lacunas/pendências.`);
