import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, now } from '../src/db.js';
import { RuntimeError } from '../src/runtime/types.js';
import { plan, setup } from './helpers.js';

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup(); });
afterEach(() => t.cleanup());

/** Simula o estado deixado por uma queda do processo no meio de uma tarefa. */
function crashedExecution(opts: { recoveries?: number; attempt?: number; sessionId?: string; taskCost?: number } = {}) {
  const ts = now(), c = newId(), e = newId(), tid = newId();
  t.services.db.insert('conversations', { id: c, title: 'x', created_at: ts, updated_at: ts });
  t.services.db.insert('executions', { id: e, conversation_id: c, request: 'pedido', status: 'executando', recoveries: opts.recoveries ?? 0, cost_usd: opts.taskCost ?? 0, plan: JSON.stringify(plan([{ chave: 'a', agente: 'pedro' }])), objective: 'o', created_at: ts, updated_at: ts });
  t.services.db.insert('tasks', { id: tid, execution_id: e, key: 'a', agent_id: 'pedro', title: 'Tarefa a', instructions: 'i', status: 'executando', attempt: opts.attempt ?? 1, session_id: opts.sessionId ?? null, cost_usd: opts.taskCost ?? 0 });
  return { e, tid };
}

describe('recuperação automática com limites', () => {
  it('retoma a tarefa interrompida a partir da sessão salva e registra a interrupção', async () => {
    const { e, tid } = crashedExecution({ sessionId: 'sessao-1', taskCost: 0.4 });
    t.runtime.agentImpl = async () => ({ text: 'ok', costUsd: 0.5 }); // custo ACUMULADO reportado pela sessão retomada
    expect(t.engine.recover()).toBe(1);
    await t.engine.whenIdle();
    const task = t.services.db.get<{ status: string; attempt: number; interruptions: number; cost_usd: number }>('SELECT * FROM tasks WHERE id = :id', { id: tid })!;
    expect(task).toMatchObject({ status: 'concluida', attempt: 2, interruptions: 1 });
    expect(t.runtime.agentCalls[0].resumeSessionId).toBe('sessao-1');
    // Sem contagem em dobro: só os 0,10 excedentes são gasto novo.
    expect(task.cost_usd).toBeCloseTo(0.5, 5);
    expect(t.exec(e).status).toBe('concluido');
    expect(t.events(e).some((x) => /retomada da sessão salva/.test(x.message))).toBe(true);
  });

  it('não retoma tarefa que já esgotou as tentativas', async () => {
    const { e, tid } = crashedExecution({ attempt: 2 });
    t.engine.recover();
    await t.engine.whenIdle();
    expect(t.services.db.get<{ status: string; error: string }>('SELECT status, error FROM tasks WHERE id = :id', { id: tid })).toMatchObject({ status: 'falhou' });
    expect(t.runtime.agentCalls).toHaveLength(0);
    expect(t.exec(e).status).toBe('falhou');
  });

  it('abandona execução que já foi retomada o máximo de vezes (sem ciclo infinito)', async () => {
    const { e } = crashedExecution({ recoveries: 2 });
    expect(t.engine.recover()).toBe(0);
    await t.engine.whenIdle();
    expect(t.exec(e)).toMatchObject({ status: 'falhou' });
    expect(t.exec(e).error).toMatch(/MD2_MAX_RECOVERIES/);
    expect(t.runtime.agentCalls).toHaveLength(0);
  });

  it('retentativa normal retoma a sessão e não conta custo em dobro', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    let n = 0;
    t.runtime.agentImpl = async () => {
      if (++n === 1) { /* registra sessão antes de falhar */ throw new RuntimeError('falha transitória', true, 0.3); }
      return { text: 'ok', costUsd: 0.45 };
    };
    // a primeira chamada precisa ter registrado uma sessão para haver retomada
    const orig = t.runtime.agentImpl;
    t.runtime.agentImpl = async (o) => { o.onActivity({ kind: 'sessao', message: 's', sessionId: 'sess-x' }); return orig(o); };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    const task = t.services.db.get<{ cost_usd: number }>('SELECT cost_usd FROM tasks WHERE execution_id = :e', { e: executionId })!;
    expect(t.runtime.agentCalls[1].resumeSessionId).toBe('sess-x');
    expect(task.cost_usd).toBeCloseTo(0.45, 5);
  });
});

describe('orçamento por tarefa, uso de tokens e auditoria', () => {
  it('passa ao runtime o menor entre teto por tarefa, execução e dia, e registra o uso', async () => {
    t.cleanup();
    t = setup({ MD2_MAX_COST_USD_PER_TASK: '1.5', MD2_MAX_COST_USD_PER_EXECUTION: '15' });
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = async () => ({ text: 'ok', costUsd: 0.2, usage: { turns: 7, inputTokens: 1000, outputTokens: 300, cacheReadTokens: 5000 } });
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.runtime.agentCalls[0].maxBudgetUsd).toBe(1.5);
    expect(t.services.db.get('SELECT turns, input_tokens, output_tokens, cache_read_tokens FROM tasks WHERE execution_id = :e', { e: executionId }))
      .toMatchObject({ turns: 7, input_tokens: 1000, output_tokens: 300, cache_read_tokens: 5000 });
    expect(t.runtime.structuredCalls.every((c) => (c.maxBudgetUsd ?? 99) <= 2)).toBe(true);
  });

  it('bloqueios do guard viram evento de segurança e entrada de auditoria', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = async (o) => { o.onActivity({ kind: 'bloqueio', tool: 'Bash', message: 'Bloqueado pelo guard de segurança: comando bloqueado (publicação)' }); return { text: 'ok', costUsd: 0 }; };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.events(executionId).some((e) => e.type === 'seguranca')).toBe(true);
    expect(t.services.db.all<{ action: string; actor: string }>(`SELECT action, actor FROM audit WHERE action = 'guard_bloqueio'`)).toEqual([expect.objectContaining({ actor: 'agente:pedro' })]);
  });
});

describe('entradas e duplicidade', () => {
  it('não sobrescreve anexo anterior com o mesmo nome', async () => {
    for (const body of ['primeiro', 'segundo']) {
      const id = newId();
      fs.mkdirSync(path.join(t.dataDir, 'uploads', id), { recursive: true });
      fs.writeFileSync(path.join(t.dataDir, 'uploads', id, 'logo.png'), body);
      t.services.db.insert('uploads', { id, name: 'logo.png', rel_path: path.join('uploads', id, 'logo.png'), size: body.length, mime: 'image/png', created_at: now() });
      t.runtime.plans.push({ modo: 'resposta_direta', titulo: 't', objetivo: 'o', resposta: 'r', tarefas: [] });
      const r = t.engine.submit({ conversationId: (t.services.db.get<{ id: string }>('SELECT id FROM conversations') ?? { id: undefined }).id, text: 'anexo', attachments: [{ id, name: 'logo.png' }] });
      await t.engine.whenIdle();
      expect(r).toBeTruthy();
    }
    const conv = t.services.db.get<{ id: string }>('SELECT id FROM conversations')!.id;
    const entrada = path.join(t.dataDir, 'workspaces', conv, 'entrada');
    expect(fs.readdirSync(entrada).sort()).toEqual(['logo (2).png', 'logo.png']);
    expect(fs.readFileSync(path.join(entrada, 'logo.png'), 'utf8')).toBe('primeiro');
  });

  it('pedido de ajuste repetido com o mesmo identificador cria uma única execução', async () => {
    t.runtime.plans.push(plan([{ chave: 'doc', agente: 'rafael' }]), plan([{ chave: 'aj', agente: 'rafael' }]));
    t.runtime.agentImpl = async (o) => {
      fs.writeFileSync(path.join(o.cwd, 'entregas/p.html'), '<p>x</p>');
      await o.handlers.registrarEntregavel({ caminho: 'entregas/p.html', nome: 'Proposta', categoria: 'proposta' });
      return { text: 'ok', costUsd: 0 };
    };
    t.engine.submit({ text: 'proposta' });
    await t.engine.whenIdle();
    const [d] = t.services.deliverables.list();
    const a = t.engine.decideDeliverable(d.id, 'ajustar', 'mudar prazo', 'req-aj-1') as { executionId: string };
    const b = t.engine.decideDeliverable(d.id, 'ajustar', 'mudar prazo', 'req-aj-1') as { executionId: string; duplicate: boolean };
    await t.engine.whenIdle();
    expect(b).toMatchObject({ executionId: a.executionId, duplicate: true });
    expect(t.services.db.all('SELECT id FROM executions')).toHaveLength(2);
  });

  it('recusa registrar entregável que aponta para fora por link simbólico', async () => {
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'bruno' }]));
    t.runtime.agentImpl = async (o) => {
      fs.symlinkSync('/etc', path.join(o.cwd, 'atalho'));
      await expect(o.handlers.registrarEntregavel({ caminho: 'atalho/hostname', nome: 'x', categoria: 'outro' })).rejects.toThrow(/link simbólico|não encontrado/);
      return { text: 'ok', costUsd: 0 };
    };
    t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.services.deliverables.list()).toHaveLength(0);
  });
});

describe('limite de uso da conta Claude', () => {
  const limit = () => new RuntimeError("Limite de uso da conta Claude atingido (You've hit your 5-hour limit).", true, 0, undefined, true);

  it('pausa sem gastar tentativas e retoma sozinho quando a conta volta', async () => {
    t.cleanup();
    t = setup({ MD2_LIMIT_RETRY_MIN: '0.0005', MD2_TASK_MAX_ATTEMPTS: '1' });
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }, { chave: 'b', agente: 'bruno' }]));
    let blocked = 3;
    t.runtime.agentImpl = async () => { if (blocked-- > 0) throw limit(); return { text: 'ok', costUsd: 0.01 }; };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.tasks(executionId).map((x) => [x.status, x.attempt])).toEqual([['concluida', 1], ['concluida', 1]]);
    expect(t.exec(executionId).status).toBe('concluido');
    const msgs = t.events(executionId).map((e) => e.message);
    expect(msgs.some((m) => /pausou a execução/.test(m))).toBe(true);
    expect(msgs.some((m) => /disponível novamente/.test(m))).toBe(true);
    expect(t.services.db.all(`SELECT id FROM audit WHERE action = 'pausa_limite_conta'`).length).toBeGreaterThan(0);
  });

  it('também aguarda quando o limite atinge o planejamento do Alfred', async () => {
    t.cleanup();
    t = setup({ MD2_LIMIT_RETRY_MIN: '0.0005' });
    t.runtime.plans.push({ modo: 'resposta_direta', titulo: 't', objetivo: 'o', resposta: 'pronto', tarefas: [] });
    const orig = t.runtime.runStructured.bind(t.runtime);
    let first = true;
    t.runtime.runStructured = (async (o: Parameters<typeof orig>[0]) => { if (first) { first = false; throw limit(); } return orig(o); }) as typeof t.runtime.runStructured;
    const { executionId } = t.engine.submit({ text: 'oi' });
    await t.engine.whenIdle();
    expect(t.exec(executionId)).toMatchObject({ status: 'concluido', summary: 'pronto' });
  });

  it('desiste com falha explícita após a espera máxima (sem ciclo infinito)', async () => {
    t.cleanup();
    t = setup({ MD2_LIMIT_RETRY_MIN: '0.0005', MD2_LIMIT_MAX_WAIT_HOURS: '0.00000002' });
    t.runtime.plans.push(plan([{ chave: 'a', agente: 'pedro' }]));
    t.runtime.agentImpl = async () => { t.runtime.ready = false; t.runtime.accountLimit = true; throw limit(); };
    const { executionId } = t.engine.submit({ text: 'x' });
    await t.engine.whenIdle();
    expect(t.exec(executionId).status).toBe('falhou');
    expect(t.exec(executionId).error).toMatch(/limite de uso da conta Claude não voltou/);
    expect(t.runtime.agentCalls).toHaveLength(1);
  });
});
