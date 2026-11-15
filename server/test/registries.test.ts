import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { alfredSystem, validatePlan } from '../src/orchestrator/alfred.js';
import { AgentRegistry } from '../src/registry/agents.js';
import { KnowledgeEngine } from '../src/registry/knowledge.js';
import { SkillRegistry } from '../src/registry/skills.js';
import { ToolRegistry } from '../src/registry/tools.js';
import { plan, ROOT } from './helpers.js';

const agents = new AgentRegistry(ROOT);
const skills = new SkillRegistry(ROOT);
const knowledge = new KnowledgeEngine(ROOT);
const config = loadConfig({}, ROOT);

describe('registro de agentes', () => {
  it('mantém exatamente 22 agentes na estrutura de departamentos definida', () => {
    expect(agents.list()).toHaveLength(22);
    const count = (d: string) => agents.list().filter((a) => a.department === d).length;
    expect({ direcao: count('direcao'), comercial: count('comercial'), juridico: count('juridico'), marketing: count('marketing'),
      desenvolvimento: count('desenvolvimento'), atendimento: count('atendimento'), financeiro: count('financeiro'),
      operacoes: count('operacoes'), producao: count('producao'), administrativo: count('administrativo') })
      .toEqual({ direcao: 1, comercial: 3, juridico: 1, marketing: 4, desenvolvimento: 4, atendimento: 2, financeiro: 2, operacoes: 2, producao: 2, administrativo: 1 });
    for (const n of ['carlos', 'lucas', 'fernanda', 'rafael', 'helena', 'mariana', 'beatriz', 'gabriel', 'pedro', 'patricia']) expect(agents.get(n), n).toBeTruthy();
    expect(agents.get('alfred')).toBeUndefined();
  });
  it('todo agente tem identidade, instruções, limites, qualidade, skills e ferramentas válidas', () => {
    const tools = new ToolRegistry(config);
    for (const a of agents.list()) {
      expect(a.specialty && a.role && a.capabilities.length && a.instructions.length && a.quality.length, a.id).toBeTruthy();
      for (const s of a.skills) expect(skills.get(s), `${a.id} -> ${s}`).toBeTruthy();
      for (const t of a.tools) expect(tools.get(t), `${a.id} -> ${t}`).toBeTruthy();
      const prompt = agents.systemPrompt(a);
      expect(prompt).toContain(a.name);
      expect(prompt).toContain('solicitar_aprovacao');
    }
  });
});

describe('skills, conhecimento e ferramentas', () => {
  it('toda skill é válida e tem responsáveis existentes', () => {
    expect(skills.problems).toEqual([]);
    expect(skills.skills.length).toBeGreaterThanOrEqual(15);
    for (const s of skills.skills) for (const o of s.owners) expect(agents.get(o), `${s.id} -> ${o}`).toBeTruthy();
    expect(skills.render('video-editing')).toContain('ffmpeg');
  });
  it('recupera conhecimento pertinente por departamento', () => {
    expect(knowledge.search('campanha de anúncios no instagram com orçamento pequeno')[0].docId).toBe('marketing/trafego-pago');
    expect(knowledge.search('multa de rescisão e proteção de dados')[0].docId).toBe('juridico/contratos-lgpd');
    expect(knowledge.search('reels vertical legendas', { departments: ['financeiro'] }).every((h) => h.department === 'financeiro')).toBe(true);
    for (const d of agents.file.departments) for (const k of d.knowledge) expect(knowledge.docs.some((doc) => doc.department === k), `${d.id} -> ${k}`).toBe(true);
  });
  it('não marca integração externa como disponível sem conector', () => {
    const tools = new ToolRegistry(config, { GITHUB_TOKEN: 'x', INSTAGRAM_ACCESS_TOKEN: 'y', INSTAGRAM_BUSINESS_ACCOUNT_ID: 'z' }, () => false);
    for (const id of ['github', 'google_drive', 'google_calendar', 'instagram', 'geracao_imagem']) expect(tools.get(id)!.status, id).toBe('pendente');
    expect(tools.get('ffmpeg')!.status).toBe('indisponivel');
    expect(tools.resolve(['arquivos', 'ffmpeg', 'instagram']).sdkTools).toEqual(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
  });
});

describe('plano do Alfred', () => {
  it('expõe a equipe e as skills no prompt de planejamento', () => {
    const p = alfredSystem(agents, skills);
    expect(p).toContain('mariana');
    expect(p).toContain('website-builder');
  });
  it('rejeita agente inexistente, dependência inválida e ciclos', () => {
    expect(validatePlan(plan([{ chave: 'a', agente: 'ninguem' }]), agents, skills)).toContain('agente inexistente: ninguem');
    expect(validatePlan(plan([{ chave: 'a', agente: 'pedro', depende_de: ['x'] }]), agents, skills)[0]).toMatch(/dependência inexistente/);
    expect(validatePlan(plan([{ chave: 'a', agente: 'pedro', depende_de: ['b'] }, { chave: 'b', agente: 'bruno', depende_de: ['a'] }]), agents, skills)).toContain('dependências circulares');
    expect(validatePlan(plan([{ chave: 'a', agente: 'pedro' }, { chave: 'b', agente: 'bruno', depende_de: ['a'] }]), agents, skills)).toEqual([]);
  });
});

describe('configuração', () => {
  it('recusa expor na rede sem senha', () => {
    expect(() => loadConfig({ MD2_HOST: '0.0.0.0' }, ROOT)).toThrow(/MD2_ADMIN_PASSWORD/);
    expect(loadConfig({ MD2_HOST: '0.0.0.0', MD2_ADMIN_PASSWORD: 'x' }, ROOT).host).toBe('0.0.0.0');
  });
});
