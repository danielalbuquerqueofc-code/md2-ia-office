import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { AgentRegistry } from '../src/registry/agents.js';
import { KnowledgeEngine } from '../src/registry/knowledge.js';
import { SkillRegistry } from '../src/registry/skills.js';
import { ToolRegistry } from '../src/registry/tools.js';
import { ROOT } from './helpers.js';

const agents = new AgentRegistry(ROOT);
const skills = new SkillRegistry(ROOT);
const knowledge = new KnowledgeEngine(ROOT);
const tools = new ToolRegistry(loadConfig({}, ROOT));
const list = agents.list();
const GATED_TOOLS = ['instagram', 'whatsapp', 'geracao_imagem'];

describe('matriz de competências: todos os campos preenchidos', () => {
  it('cada agente tem os 14 campos exigidos, não vazios', () => {
    for (const a of list) {
      for (const [campo, v] of Object.entries({
        responsabilidadePrincipal: a.specialty, secundarias: a.secondaryResponsibilities, conhecimentos: a.knowledge, skills: a.skills,
        ferramentasPermitidas: a.tools, ferramentasProibidas: a.toolsForbidden, limitesAutonomia: a.autonomy.cannot,
        gatilhos: a.receiveWhen, solicitarOutros: a.requestOthersWhen, formatoEntrega: a.delivery.format, entregasTipicas: a.delivery.typical,
        criteriosQualidade: a.quality, instrucoes: a.instructions,
      })) expect(Array.isArray(v) ? v.length : String(v).trim().length, `${a.id}.${campo}`).toBeGreaterThan(0);
      expect(a.autonomy.can.length, `${a.id}.autonomy.can`).toBeGreaterThan(0);
    }
  });

  it('referências válidas: conhecimento, skills, ferramentas e agentes citados existem', () => {
    for (const a of list) {
      for (const k of a.knowledge) expect(knowledge.get(k), `${a.id} conhecimento ${k}`).toBeTruthy();
      for (const s of a.skills) expect(skills.get(s), `${a.id} skill ${s}`).toBeTruthy();
      for (const t of [...a.tools, ...a.toolsForbidden]) expect(tools.get(t), `${a.id} ferramenta ${t}`).toBeTruthy();
      for (const r of a.requestOthersWhen) { expect(agents.get(r.agent), `${a.id} -> ${r.agent}`).toBeTruthy(); expect(r.agent).not.toBe(a.id); }
    }
  });

  it('skills e responsáveis são consistentes nos dois sentidos, e nenhuma skill fica órfã', () => {
    for (const s of skills.skills) {
      expect(s.owners.length, s.id).toBeGreaterThan(0);
      for (const o of s.owners) expect(agents.get(o)?.skills, `${s.id} -> ${o}`).toContain(s.id);
    }
    for (const a of list) for (const id of a.skills) expect(skills.get(id)!.owners, `${a.id} usa ${id}`).toContain(a.id);
  });
});

describe('especialização verdadeira: 22 nomes, 22 funções distintas', () => {
  it('responsabilidade principal e entregas típicas não se repetem entre agentes', () => {
    const spec = new Set(list.map((a) => a.specialty));
    expect(spec.size).toBe(22);
    const deliverables = list.flatMap((a) => a.delivery.typical);
    expect(new Set(deliverables).size).toBe(deliverables.length);
  });

  it('nenhum par de agentes tem o mesmo conjunto de skills e ferramentas', () => {
    const sig = list.map((a) => `${[...a.skills].sort()}|${[...a.tools].sort()}`);
    expect(new Set(sig).size).toBe(22);
  });

  it('cada agente é o único responsável por pelo menos uma skill', () => {
    for (const a of list) {
      const exclusivas = a.skills.filter((s) => skills.get(s)!.owners.length === 1);
      expect(exclusivas.length, `${a.id} sem skill própria`).toBeGreaterThan(0);
    }
  });

  it('todos os departamentos têm skills e conhecimento próprios', () => {
    for (const d of agents.file.departments) {
      expect(knowledge.docs.some((k) => k.department === d.id || d.knowledge.includes(k.department)), d.id).toBe(true);
      expect(list.some((a) => a.department === d.id && a.skills.length > 0), d.id).toBe(true);
    }
  });
});

describe('permissões por agente (privilégio mínimo)', () => {
  const bash = (id: string) => tools.resolve(agents.get(id)!.tools).sdkTools.includes('Bash');
  const COM_SHELL = ['andre', 'diego', 'sofia', 'gabriel', 'renata', 'eduardo'];

  it('só os agentes técnicos e de cálculo recebem Bash', () => {
    for (const a of list) expect(bash(a.id), `${a.id} Bash`).toBe(COM_SHELL.includes(a.id));
  });

  it('ferramentas permitidas e proibidas são disjuntas e cobrem todo o registro', () => {
    const todas = tools.tools.map((t) => t.id).sort();
    for (const a of list) {
      expect(a.tools.filter((t) => a.toolsForbidden.includes(t)), a.id).toEqual([]);
      expect([...a.tools, ...a.toolsForbidden].sort(), a.id).toEqual(todas);
    }
  });

  it('ferramentas que agem no mundo externo não são concedidas a ninguém', () => {
    for (const a of list) for (const t of GATED_TOOLS) expect(a.tools, `${a.id} ${t}`).not.toContain(t);
  });

  it('o que o SDK recebe é exatamente o permitido: agentes sem shell não têm Bash; quem declara arquivos tem Write', () => {
    for (const a of list) {
      const r = tools.resolve(a.tools);
      expect(r.sdkTools.includes('Write'), a.id).toBe(a.tools.includes('arquivos'));
      for (const p of r.pending) expect(a.tools).toContain(p.id);
    }
  });

  it('quem exige aprovação humana de publicação não tem ferramenta para publicar', () => {
    for (const a of list.filter((x) => x.autonomy.needsApproval.includes('publicacao'))) for (const t of ['instagram', 'whatsapp']) expect(a.tools).not.toContain(t);
  });

  it('níveis de autonomia coerentes com as ferramentas', () => {
    for (const a of list) {
      if (a.autonomy.level === 'execucao_tecnica') expect(bash(a.id), a.id).toBe(true);
      else expect(bash(a.id), `${a.id} tem Bash mas não é execucao_tecnica`).toBe(false);
    }
  });

  it('o prompt de cada agente carrega cargo original, limites, autonomia e pedidos a Alfred', () => {
    for (const a of list) {
      const p = agents.systemPrompt(a);
      expect(p).toContain(a.role);
      expect(p).toContain('Você não pode');
      expect(p).toContain('Pedidos a Alfred');
      expect(p).toContain(a.quality[0]);
    }
  });
});

describe('roteamento: o catálogo do Alfred mostra a quem acionar e quando', () => {
  it('lista os 22 agentes com gatilhos, entregas e skills', () => {
    const c = agents.catalog();
    for (const a of list) { expect(c).toContain(`**${a.id}**`); expect(c).toContain(a.receiveWhen[0]); }
    expect(c).toContain('Acione quando');
    expect(c.length).toBeLessThan(26_000);
  });
});
