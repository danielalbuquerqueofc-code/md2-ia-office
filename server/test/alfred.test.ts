import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateExtraTasks, validatePlan } from '../src/orchestrator/alfred.js';
import type { PlanTask } from '../src/orchestrator/alfred.js';
import { AgentRegistry } from '../src/registry/agents.js';
import { KnowledgeEngine } from '../src/registry/knowledge.js';
import { SkillRegistry } from '../src/registry/skills.js';
import { newId, now } from '../src/db.js';
import { plan, ROOT, setup } from './helpers.js';

const agents = new AgentRegistry(ROOT);
const skills = new SkillRegistry(ROOT);
const errorsOf = (p: ReturnType<typeof plan>) => validatePlan(p, agents, skills);

describe('validação determinística do plano do Alfred', () => {
  it('site ou vídeo sem QA independente depois da construção é rejeitado', () => {
    expect(errorsOf(plan([{ chave: 'site', agente: 'andre', skills: ['website-builder'] }])).join()).toMatch(/precisa de uma tarefa de QA de sofia/);
    expect(errorsOf(plan([{ chave: 'v', agente: 'diego', skills: ['video-editing'] }])).join()).toMatch(/QA/);
    const ok = plan([{ chave: 'site', agente: 'andre', skills: ['website-builder'] }, { chave: 'qa', agente: 'sofia', depende_de: ['site'], skills: ['quality-assurance'] }]);
    expect(errorsOf(ok)).toEqual([]);
  });
  it('o QA vale também por dependência indireta, mas não quando é independente da construção', () => {
    const indireto = plan([{ chave: 'site', agente: 'andre', skills: ['website-builder'] }, { chave: 'rev', agente: 'vinicius', depende_de: ['site'] }, { chave: 'qa', agente: 'sofia', depende_de: ['rev'], skills: ['quality-assurance'] }]);
    expect(errorsOf(indireto)).toEqual([]);
    const solto = plan([{ chave: 'site', agente: 'andre', skills: ['website-builder'] }, { chave: 'qa', agente: 'sofia', skills: ['quality-assurance'] }]);
    expect(errorsOf(solto).join()).toMatch(/QA/);
  });
  it('rejeita skill atribuída a quem não é responsável por ela', () => {
    expect(errorsOf(plan([{ chave: 'a', agente: 'camila', skills: ['website-builder'] }])).join()).toMatch(/a skill website-builder não pertence a camila \(responsáveis: andre\)/);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', skills: ['video-editing'] }])).join()).toMatch(/não pertence a isabela/);
  });
  it('rejeita entrega duplicada, tarefa duplicada, caminho inválido e falta de critérios', () => {
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', entrega_esperada: 'entregas/t.md' }, { chave: 'b', agente: 'vinicius', entrega_esperada: 'entregas/t.md' }])).join()).toMatch(/entrega duplicada/);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', titulo: 'Escrever textos' }, { chave: 'b', agente: 'isabela', titulo: 'escrever  TEXTOS' }])).join()).toMatch(/tarefa duplicada/);
    for (const bad of ['../fora.md', '/etc/passwd', 'trabalho/x.md', 'entregas/../../x']) expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', entrega_esperada: bad }])).join(), bad).toMatch(/entregas\//);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', criterios_de_aceite: [] }])).join()).toMatch(/criterios_de_aceite/);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', criterios_de_aceite: ['1', '2', '3', '4', '5', '6', '7'] }])).join()).toMatch(/criterios_de_aceite/);
  });
  it('detecta ciclos de qualquer tamanho e auto-dependência', () => {
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', depende_de: ['b'] }, { chave: 'b', agente: 'vinicius', depende_de: ['a'] }])).join()).toMatch(/circulares/);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', depende_de: ['c'] }, { chave: 'b', agente: 'vinicius', depende_de: ['a'] }, { chave: 'c', agente: 'sofia', depende_de: ['b'] }])).join()).toMatch(/circulares/);
    expect(errorsOf(plan([{ chave: 'a', agente: 'isabela', depende_de: ['a'] }])).join()).toMatch(/circulares/);
  });
  it('tarefas extras da validação: aceita as válidas, renomeia chave repetida e descarta agente inexistente', () => {
    const base = { titulo: 't', instrucoes: 'i', depende_de: ['a', 'zzz'], skills: ['content-review', 'website-builder'], entrega_esperada: '', criterios_de_aceite: [] } satisfies Omit<PlanTask, 'chave' | 'agente'>;
    const r = validateExtraTasks([{ ...base, chave: 'a', agente: 'vinicius' }, { ...base, chave: 'x', agente: 'fantasma' }], new Set(['a']), agents, skills);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({ chave: 'a_2', depende_de: ['a'], skills: ['content-review'] });
    expect(r.accepted[0].criterios_de_aceite.length).toBe(1);
    expect(r.rejected.join()).toMatch(/agente inexistente/);
  });
});

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup(); });
afterEach(() => t.cleanup());

describe('Alfred cobra resultados dos agentes', () => {
  const expected = 'entregas/proposta.html';
  const writeAndRegister = async (o: Parameters<typeof t.runtime.agentImpl>[0]) => {
    fs.mkdirSync(path.join(o.cwd, 'entregas'), { recursive: true });
    fs.writeFileSync(path.join(o.cwd, expected), '<p>proposta</p>');
    await o.handlers.registrarEntregavel({ caminho: expected, nome: 'Proposta', categoria: 'proposta' });
  };

  it('arquivo esperado ausente: cobra uma vez, retoma a sessão e conclui sem gastar tentativa', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'rafael', entrega_esperada: expected, criterios_de_aceite: ['Proposta existe', 'Soma confere'] }]));
    let n = 0;
    t.runtime.agentImpl = async (o) => {
      o.onActivity({ kind: 'sessao', message: 's', sessionId: 'sess-r' });
      if (++n === 2) await writeAndRegister(o);
      return { text: n === 1 ? 'Pronto, entreguei.' : 'Agora sim.', costUsd: 0.01, sessionId: 'sess-r' };
    };
    const { executionId } = t.engine.submit({ text: 'Faça a proposta' });
    await t.engine.whenIdle();
    const task = t.services.db.get<{ status: string; attempt: number; cobrancas: number; check_note: string | null }>('SELECT * FROM tasks WHERE execution_id = :e', { e: executionId })!;
    expect(task).toMatchObject({ status: 'concluida', attempt: 1, cobrancas: 1, check_note: null });
    expect(t.runtime.agentCalls).toHaveLength(2);
    expect(t.runtime.agentCalls[1].resumeSessionId).toBe('sess-r');
    expect(t.runtime.agentCalls[1].prompt).toMatch(/Cobrança de Alfred[\s\S]*ARQUIVO ESPERADO AUSENTE OU VAZIO \(entregas\/proposta\.html\)/);
    expect(t.runtime.agentCalls[0].prompt).toMatch(/Critérios de aceite[\s\S]*Proposta existe[\s\S]*Soma confere/);
    expect(t.runtime.agentCalls[0].prompt).toMatch(/Entrega esperada[\s\S]*entregas\/proposta\.html/);
    expect(t.events(executionId).some((e) => /Alfred cobrou Rafael/.test(e.message))).toBe(true);
    expect(t.exec(executionId).status).toBe('concluido');
  });

  it('cobra só uma vez: se continuar faltando, conclui com pendência registrada e Alfred a vê na validação', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'rafael', entrega_esperada: expected }]));
    t.runtime.agentImpl = async (o) => { o.onActivity({ kind: 'sessao', message: 's', sessionId: 's1' }); return { text: 'entreguei (não entreguei)', costUsd: 0.01, sessionId: 's1' }; };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls).toHaveLength(2);
    const task = t.services.db.get<{ status: string; cobrancas: number; check_note: string }>('SELECT * FROM tasks WHERE execution_id = :e', { e: executionId })!;
    expect(task.status).toBe('concluida');
    expect(task.cobrancas).toBe(1);
    expect(task.check_note).toMatch(/AUSENTE OU VAZIO/);
    expect(t.events(executionId).some((e) => e.type === 'erro' && /segue pendente após a cobrança/.test(e.message))).toBe(true);
    const review = t.runtime.structuredCalls.at(-1)!;
    expect(review.prompt).toMatch(/Verificação objetiva do sistema: ARQUIVO ESPERADO AUSENTE OU VAZIO/);
    expect(review.prompt).toMatch(/Alfred já cobrou esta tarefa 1x/);
  });

  it('entregou o arquivo mas não registrou como entregável: também é cobrado', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'rafael', entrega_esperada: expected }]));
    let n = 0;
    t.runtime.agentImpl = async (o) => {
      o.onActivity({ kind: 'sessao', message: 's', sessionId: 's2' });
      if (++n === 1) { fs.mkdirSync(path.join(o.cwd, 'entregas'), { recursive: true }); fs.writeFileSync(path.join(o.cwd, expected), 'x'); }
      else await o.handlers.registrarEntregavel({ caminho: expected, nome: 'Proposta', categoria: 'proposta' });
      return { text: 'ok', costUsd: 0, sessionId: 's2' };
    };
    t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls[1].prompt).toMatch(/arquivo esperado presente[\s\S]*NENHUM entregável registrado/);
    expect(t.services.deliverables.list()).toHaveLength(1);
  });

  it('tarefa sem arquivo esperado (só texto) não é cobrada', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'carlos' }]));
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls).toHaveLength(1);
    expect(t.services.db.get<{ cobrancas: number }>('SELECT cobrancas FROM tasks WHERE execution_id = :e', { e: executionId })!.cobrancas).toBe(0);
  });
});

describe('Alfred aciona outro especialista quando um agente pede', () => {
  const extra = (agente: string, chave: string): PlanTask => ({ chave, agente, titulo: `Extra ${chave}`, instrucoes: 'Revise.', depende_de: ['a'], skills: [], entrega_esperada: '', criterios_de_aceite: ['Revisado'] });

  it('cria a tarefa extra na validação, executa e relata o que descartou', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'isabela' }]));
    t.runtime.reviews.push(
      { aprovado: true, correcoes: [], novas_tarefas: [extra('vinicius', 'rev'), extra('fantasma', 'x')], resposta_final: '' },
      { aprovado: true, correcoes: [], novas_tarefas: [], resposta_final: 'Tudo revisado.' },
    );
    const { executionId } = t.engine.submit({ text: 'Escreva e revise' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId).map((x) => [x.key, x.status])).toEqual([['a', 'concluida'], ['rev', 'concluida']]);
    const m = t.events(executionId).map((e) => e.message);
    expect(m.some((x) => /Alfred acionou Vinícius/.test(x))).toBe(true);
    expect(m.some((x) => /descartou uma tarefa extra: x: agente inexistente/.test(x))).toBe(true);
    expect(t.exec(executionId)).toMatchObject({ status: 'concluido', summary: 'Tudo revisado.' });
  });

  it('só há uma rodada: pedidos extras na segunda validação são descartados', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'isabela' }]));
    t.runtime.reviews.push(
      { aprovado: true, correcoes: [], novas_tarefas: [extra('vinicius', 'rev')], resposta_final: '' },
      { aprovado: true, correcoes: [], novas_tarefas: [extra('sofia', 'mais')], resposta_final: 'Fim.' },
    );
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId)).toHaveLength(2);
    expect(t.events(executionId).some((e) => /sem rodada disponível/.test(e.message))).toBe(true);
  });
});

describe('prévia do plano', () => {
  it('não cria execução nem tarefa, registra o custo e conta no gasto do dia', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'lucas', entrega_esperada: 'entregas/pesquisa/b.md' }]));
    const r = await t.engine.previewPlan({ text: 'Analise esta empresa' });
    expect(r.errors).toEqual([]);
    expect(r.plan.tarefas[0].agente).toBe('lucas');
    expect(t.services.db.all('SELECT id FROM executions')).toHaveLength(0);
    expect(t.services.db.all('SELECT id FROM tasks')).toHaveLength(0);
    expect(t.runtime.agentCalls).toHaveLength(0);
    expect(t.services.db.get<{ c: number; n: number }>('SELECT SUM(cost_usd) AS c, COUNT(*) AS n FROM previews')).toMatchObject({ n: 1 });
    expect(t.services.db.get<{ c: number }>('SELECT SUM(cost_usd) AS c FROM previews')!.c).toBeCloseTo(0.001, 5);
    expect(t.services.db.all(`SELECT id FROM audit WHERE action = 'plan_preview'`)).toHaveLength(1);
  });

  it('plano inválido volta ao Alfred para correção e o erro final é devolvido se persistir', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'fantasma' }]), plan([{ chave: 'a', agente: 'lucas' }]));
    const r = await t.engine.previewPlan({ text: 'x' });
    expect(r.errors).toEqual([]);
    expect(t.runtime.structuredCalls[1].prompt).toContain('agente inexistente: fantasma');
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'fantasma' }]), plan([{ chave: 'a', agente: 'fantasma' }]));
    const bad = await t.engine.previewPlan({ text: 'y' });
    expect(bad.errors.join()).toMatch(/agente inexistente/);
  });

  it('o gasto das prévias entra no limite diário: bloqueia nova prévia e nova execução', async () => {
    t.cleanup();
    t = setup({ MD2_MAX_COST_USD_PER_DAY: '1' });
    t.services.db.insert('previews', { id: newId(), request: 'x', plan: '{}', errors: '[]', cost_usd: 1.5, created_at: now() });
    await expect(t.engine.previewPlan({ text: 'x' })).rejects.toThrow(/Limite diário/);
    const { executionId } = t.engine.submit({ text: 'oi' });
    await t.engine.whenIdle();
    expect(t.exec(executionId)).toMatchObject({ status: 'falhou' });
    expect(t.exec(executionId).error).toMatch(/Limite diário/);
  });
});

describe('contexto que o Alfred recebe', () => {
  it('o plano vê os nomes reais das pastas autorizadas (acentos preservados) para casar "Pão de Mel"', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-auth-'));
    fs.mkdirSync(path.join(dir, 'Pão de Mel'));
    fs.writeFileSync(path.join(dir, 'Pão de Mel', 'segredo.mp4'), 'x');
    fs.mkdirSync(path.join(dir, 'Contratos'));
    fs.writeFileSync(path.join(dir, '.oculto'), 'x');
    t.cleanup();
    t = setup({ MD2_AUTHORIZED_DIRS: dir });
    t.runtime.plans.push({ modo: 'resposta_direta', titulo: 't', objetivo: 'o', resposta: 'r', tarefas: [] });
    t.engine.submit({ text: 'Encontre a pasta Pão de Mel' });
    await t.engine.whenIdle();
    const prompt = t.runtime.structuredCalls[0].prompt;
    expect(prompt).toContain(dir);
    expect(prompt).toContain('Pão de Mel/');
    expect(prompt).toContain('Contratos/');
    expect(prompt).not.toContain('.oculto');
    expect(prompt).not.toContain('segredo.mp4'); // só o primeiro nível
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('o prompt do planejamento traz o catálogo com gatilhos e as regras de QA, duplicidade e critérios', async () => {
    t.runtime.plans.push({ modo: 'resposta_direta', titulo: 't', objetivo: 'o', resposta: 'r', tarefas: [] });
    t.engine.submit({ text: 'oi' });
    await t.engine.whenIdle();
    const sys = t.runtime.structuredCalls[0].system;
    expect(sys).toMatch(/Acione quando/);
    expect(sys).toMatch(/QA de sofia|tarefa de sofia/);
    expect(sys).toMatch(/entrega_esperada/);
    expect(sys).toMatch(/criterios_de_aceite/);
    expect(sys).toMatch(/Evite trabalho duplicado/);
    expect(sys).toMatch(/Skill de outro agente é rejeitada/);
  });

  it('o conhecimento do próprio especialista ganha peso na recuperação', () => {
    const k = new KnowledgeEngine(ROOT);
    const hits = k.search('cliente resultado campanha mensagem', { limit: 60 });
    const alvo = hits.find((h) => h.docId === 'atendimento/atendimento-sucesso')!;
    const boosted = k.search('cliente resultado campanha mensagem', { limit: 60, boost: ['atendimento/atendimento-sucesso'] }).find((h) => h.docId === alvo.docId && h.heading === alvo.heading)!;
    expect(boosted.score / alvo.score).toBeCloseTo(1.6, 5);
  });
});
