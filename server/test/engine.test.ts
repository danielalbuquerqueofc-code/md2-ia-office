import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, now } from '../src/db.js';
import { RuntimeError } from '../src/runtime/types.js';
import { plan, setup, sleep } from './helpers.js';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup(); });
afterEach(() => t.cleanup());

describe('motor de orquestração (runtime substituído por dublê de teste)', () => {
  it('responde diretamente a perguntas simples sem criar tarefas', async () => {
    t.runtime.plans.push({ modo: 'resposta_direta', titulo: 'Oi', objetivo: 'cumprimentar', resposta: 'Olá, Daniel.', tarefas: [] });
    const { executionId, conversationId } = t.engine.submit({ text: 'Oi Alfred' });
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('concluido');
    expect(t.tasks(executionId)).toHaveLength(0);
    expect(t.runtime.agentCalls).toHaveLength(0);
    const msgs = t.services.db.all<{ role: string; content: string }>('SELECT role, content FROM messages WHERE conversation_id = :c ORDER BY rowid', { c: conversationId });
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1].content).toBe('Olá, Daniel.');
  });

  it('executa tarefas independentes em paralelo, respeita dependências e consolida', async () => {
    t.runtime.plans.push(plan([
      { chave: 'pesquisa', agente: 'mariana', skills: ['market-research'] },
      { chave: 'estrategia', agente: 'beatriz' },
      { chave: 'site', agente: 'bruno', depende_de: ['pesquisa', 'estrategia'], skills: ['website-builder'] },
    ]));
    const live = new Set<string>();
    let maxLive = 0;
    const order: string[] = [];
    t.runtime.agentImpl = async (o) => {
      const key = /# Tarefa: Tarefa (\w+)/.exec(o.prompt)![1];
      live.add(key); maxLive = Math.max(maxLive, live.size);
      await sleep(40);
      if (key === 'site') {
        fs.mkdirSync(path.join(o.cwd, 'entregas/site'), { recursive: true });
        fs.writeFileSync(path.join(o.cwd, 'entregas/site/index.html'), '<h1>Site</h1>');
        await o.handlers.registrarEntregavel({ caminho: 'entregas/site', nome: 'Site — Teste', categoria: 'site' });
      }
      o.onActivity({ kind: 'ferramenta', tool: 'Write', message: `Escrevendo ${key}` });
      live.delete(key); order.push(key);
      return { text: `resultado de ${key}`, costUsd: 0.02, sessionId: `s-${key}` };
    };
    const { executionId } = t.engine.submit({ text: 'Crie um site para a empresa X' });
    await t.engine.whenIdle();

    expect(t.exec(executionId).status).toBe('concluido');
    expect(maxLive).toBe(2);
    expect(order[2]).toBe('site');
    expect(t.tasks(executionId).map((x) => x.status)).toEqual(['concluida', 'concluida', 'concluida']);
    const site = t.runtime.agentCalls.find((c) => c.prompt.includes('Tarefa site'))!;
    expect(site.prompt).toContain('resultado de pesquisa');
    expect(site.prompt).toContain('Skill: Construção de site profissional');
    expect(site.sdkTools).toContain('Bash');
    expect(site.system).toContain('Você é Bruno');
    expect(t.exec(executionId).cost_usd).toBeCloseTo(0.062, 3);

    const msgs = t.events(executionId).map((e) => e.message);
    expect(msgs[0]).toBe('Alfred recebeu a solicitação.');
    expect(msgs).toContain('Mariana iniciou: Tarefa pesquisa');
    expect(msgs).toContain('Bruno concluiu: Tarefa site');
    expect(msgs.at(-1)).toBe('Execução concluída.');

    const [d] = t.services.deliverables.list({ executionId });
    expect(d).toMatchObject({ name: 'Site — Teste', category: 'site', status: 'para_revisao', agent_id: 'bruno' });
    expect(fs.existsSync(path.join(t.dataDir, 'deliverables', d.id, 'v1', 'index.html'))).toBe(true);
  });

  it('tenta novamente após falha e conclui', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    let n = 0;
    t.runtime.agentImpl = async () => { if (++n === 1) throw new RuntimeError('falha transitória', true, 0.01); return { text: 'ok', costUsd: 0.01 }; };
    const { executionId } = t.engine.submit({ text: 'Escreva um texto' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId)[0]).toMatchObject({ status: 'concluida', attempt: 2 });
    expect(t.events(executionId).some((e) => e.type === 'erro' && /nova tentativa/.test(e.message))).toBe(true);
    expect(t.runtime.agentCalls[1].prompt).toContain('A tentativa anterior falhou: falha transitória');
  });

  it('falha definitiva cancela dependentes, mantém independentes e é relatada sem maquiagem', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }, { chave: 'b', agente: 'bruno', depende_de: ['a'] }, { chave: 'c', agente: 'mariana' }]));
    t.runtime.agentImpl = async (o) => { if (o.prompt.includes('Tarefa a')) throw new Error('quebrou'); return { text: 'ok', costUsd: 0 }; };
    const { executionId } = t.engine.submit({ text: 'Faça três coisas' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId).map((x) => [x.key, x.status])).toEqual([['a', 'falhou'], ['b', 'cancelada'], ['c', 'concluida']]);
    expect(t.exec(executionId).status).toBe('concluido');
    const review = t.runtime.structuredCalls.at(-1)!;
    expect(review.prompt).toContain('Status: falhou');
    expect(review.prompt).toContain('Erro: quebrou');
  });

  it('marca a execução como falha quando nenhuma tarefa conclui', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = async () => { throw new RuntimeError('sem saída', false); };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('falhou');
    expect(t.tasks(executionId)[0].attempt).toBe(1);
  });

  it('Alfred solicita correção após a validação (uma rodada)', async () => {
    t.runtime.plans.push(plan([{ chave: 'copy', agente: 'pedro' }]));
    t.runtime.reviews.push({ aprovado: false, correcoes: [{ chave: 'copy', instrucoes: 'Faltou a chamada para ação.' }], resposta_final: '' },
      { aprovado: true, correcoes: [], resposta_final: 'Texto pronto.' });
    const { executionId } = t.engine.submit({ text: 'Escreva a copy' });
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls).toHaveLength(2);
    expect(t.runtime.agentCalls[1].prompt).toContain('Faltou a chamada para ação.');
    expect(t.exec(executionId)).toMatchObject({ status: 'concluido', summary: 'Texto pronto.' });
  });

  it('pedido de aprovação deixa a execução aguardando e só conclui após decisão humana', async () => {
    t.runtime.plans.push(plan([{ chave: 'post', agente: 'pedro' }]));
    t.runtime.agentImpl = async (o) => {
      const r = await o.handlers.solicitarAprovacao({ tipo: 'publicacao', titulo: 'Publicar post no Instagram', descricao: 'Post X', dados: 'legenda' });
      expect(r).toContain('NÃO execute');
      return { text: 'post preparado', costUsd: 0 };
    };
    const { executionId } = t.engine.submit({ text: 'Prepare e publique um post' });
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('aguardando_aprovacao');
    const a = t.services.db.get<{ id: string; status: string }>('SELECT id, status FROM approvals WHERE execution_id = :e', { e: executionId })!;
    expect(a.status).toBe('pendente');
    const out = t.engine.decideApproval(a.id, 'aprovar');
    expect(out.outcome).toMatch(/nada foi publicado/);
    expect(t.exec(executionId).status).toBe('concluido');
    expect(() => t.engine.decideApproval(a.id, 'rejeitar')).toThrow(/já foi decidida/);
    expect(t.services.db.all('SELECT * FROM audit').length).toBeGreaterThan(1);
  });

  it('retoma execução interrompida sem refazer tarefas concluídas', async () => {
    const ts = now();
    const c = newId(), e = newId();
    t.services.db.insert('conversations', { id: c, title: 'x', created_at: ts, updated_at: ts });
    t.services.db.insert('executions', { id: e, conversation_id: c, request: 'pedido', status: 'executando', plan: JSON.stringify(plan([{ chave: 'a', agente: 'pedro' }, { chave: 'b', agente: 'bruno', depende_de: ['a'] }])), objective: 'o', created_at: ts, updated_at: ts });
    t.services.db.insert('tasks', { id: newId(), execution_id: e, key: 'a', agent_id: 'pedro', title: 'Tarefa a', instructions: 'i', status: 'concluida', result: 'pronto antes da queda' });
    t.services.db.insert('tasks', { id: newId(), execution_id: e, key: 'b', agent_id: 'bruno', title: 'Tarefa b', instructions: 'i', depends_on: '["a"]', status: 'executando', attempt: 1 });
    expect(t.engine.recover()).toBe(1);
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls).toHaveLength(1);
    expect(t.runtime.agentCalls[0].prompt).toContain('pronto antes da queda');
    expect(t.runtime.structuredCalls.filter((s) => 'modo' in (s.schema as any).properties)).toHaveLength(0);
    expect(t.exec(e).status).toBe('concluido');
  });

  it('não duplica execução com o mesmo clientRequestId', async () => {
    t.runtime.plans.push({ modo: 'resposta_direta', titulo: 't', objetivo: 'o', resposta: 'r', tarefas: [] });
    const a = t.engine.submit({ text: 'oi', clientRequestId: 'req-1' });
    const b = t.engine.submit({ text: 'oi', clientRequestId: 'req-1' });
    await t.engine.whenIdle();
    expect(b).toMatchObject({ executionId: a.executionId, duplicate: true });
    expect(t.services.db.all('SELECT id FROM executions')).toHaveLength(1);
  });

  it('interrompe tarefas ao atingir o limite de custo da execução', async () => {
    t.cleanup();
    t = setup({ MD2_MAX_COST_USD_PER_EXECUTION: '0.05' });
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }, { chave: 'b', agente: 'bruno', depende_de: ['a'] }]));
    t.runtime.agentImpl = async () => ({ text: 'caro', costUsd: 0.06 });
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId).map((x) => x.status)).toEqual(['concluida', 'falhou']);
    expect(t.tasks(executionId)[1].error).toMatch(/Limite de custo/);
    expect(t.runtime.agentCalls).toHaveLength(1);
  });

  it('aplica tempo limite por tarefa', async () => {
    t.cleanup();
    t = setup({ MD2_TASK_TIMEOUT_MIN: '0.001', MD2_TASK_MAX_ATTEMPTS: '1' });
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = (o) => new Promise((_res, rej) => o.signal.addEventListener('abort', () => rej(new Error('abortado'))));
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId)[0].error).toMatch(/Tempo limite/);
  });

  it('falha com mensagem clara quando o runtime não está configurado, sem simular nada', async () => {
    t.runtime.ready = false;
    const { executionId, conversationId } = t.engine.submit({ text: 'Crie um site' });
    await t.engine.whenIdle();
    expect(t.exec(executionId)).toMatchObject({ status: 'falhou', error: 'Runtime indisponível (teste).' });
    expect(t.runtime.agentCalls).toHaveLength(0);
    const last = t.services.db.get<{ content: string }>(`SELECT content FROM messages WHERE conversation_id = :c AND role = 'assistant'`, { c: conversationId })!;
    expect(last.content).toContain('Nada foi marcado como entregue');
  });

  it('refaz o plano quando Alfred escolhe um agente inexistente', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'fantasma' }]), plan([{ chave: 'a', agente: 'pedro' }]));
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('concluido');
    expect(t.runtime.structuredCalls[1].prompt).toContain('agente inexistente: fantasma');
  });

  it('cancela uma execução em andamento', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = (o) => new Promise((_res, rej) => o.signal.addEventListener('abort', () => rej(new Error('abortado'))));
    const { executionId } = t.engine.submit({ text: 'x' });
    while (!t.runtime.agentCalls.length) await sleep(5);
    expect(t.engine.cancel(executionId)).toBe(true);
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('cancelado');
    expect(t.tasks(executionId)[0].status).toBe('cancelada');
  });

  it('versiona entregáveis e transforma pedido de ajuste em nova execução na mesma conversa', async () => {
    t.runtime.plans.push(plan([{ chave: 'doc', agente: 'rafael' }]), plan([{ chave: 'ajuste', agente: 'rafael' }]));
    let v = 0;
    t.runtime.agentImpl = async (o) => {
      fs.writeFileSync(path.join(o.cwd, 'entregas/proposta.html'), `<p>versão ${++v}</p>`);
      await o.handlers.registrarEntregavel({ caminho: 'entregas/proposta.html', nome: 'Proposta', categoria: 'proposta', cliente: 'ACME' });
      await expect(o.handlers.registrarEntregavel({ caminho: '../../fora.txt', nome: 'x', categoria: 'outro' })).rejects.toThrow(/dentro do workspace/);
      await expect(o.handlers.registrarEntregavel({ caminho: 'nao-existe.pdf', nome: 'x', categoria: 'outro' })).rejects.toThrow(/não encontrado/);
      return { text: 'ok', costUsd: 0 };
    };
    const first = t.engine.submit({ text: 'Gere a proposta' });
    await t.engine.whenIdle();
    const [d] = t.services.deliverables.list();
    expect(() => t.engine.decideDeliverable(d.id, 'ajustar', ' ')).toThrow(/Descreva/);
    const again = t.engine.decideDeliverable(d.id, 'ajustar', 'Trocar o prazo para 30 dias') as { conversationId: string; executionId: string };
    expect(again.conversationId).toBe(first.conversationId);
    await t.engine.whenIdle();
    const [d2] = t.services.deliverables.list();
    expect(d2.versions.map((x) => x.version)).toEqual([2, 1]);
    expect(d2.status).toBe('para_revisao');
    expect(fs.readFileSync(path.join(t.dataDir, 'deliverables', d.id, 'v1', 'proposta.html'), 'utf8')).toContain('versão 1');
    expect(t.runtime.structuredCalls.find((s) => s.prompt.includes('Trocar o prazo'))!.prompt).toContain('- Proposta (proposta, v1');
    t.engine.decideDeliverable(d.id, 'aprovar');
    expect(t.services.deliverables.list()[0].status).toBe('aprovado');
  });
});
