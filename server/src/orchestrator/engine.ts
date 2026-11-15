import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import type { Db, ExecutionRow, ExecutionStatus, TaskRow } from '../db.js';
import { newId, now, TERMINAL } from '../db.js';
import type { EventBus } from '../events.js';
import type { AgentRegistry } from '../registry/agents.js';
import type { KnowledgeEngine } from '../registry/knowledge.js';
import type { SkillRegistry } from '../registry/skills.js';
import type { ToolRegistry } from '../registry/tools.js';
import type { AgentRuntime, AgentToolHandlers } from '../runtime/types.js';
import { RuntimeError } from '../runtime/types.js';
import type { Plan, Review } from './alfred.js';
import { alfredSystem, INJECTION_RULE, PLAN_SCHEMA, REVIEW_SCHEMA, reviewSystem, validatePlan } from './alfred.js';
import type { Deliverables } from './deliverables.js';

export interface Services {
  config: Config; db: Db; bus: EventBus; runtime: AgentRuntime;
  agents: AgentRegistry; knowledge: KnowledgeEngine; skills: SkillRegistry; tools: ToolRegistry; deliverables: Deliverables;
}
export interface Attachment { id: string; name: string }

const STATUS_TEXT: Record<ExecutionStatus, string> = {
  recebido: 'Alfred recebeu a solicitação.',
  analisando: 'Alfred está analisando o pedido.',
  planejando: 'Alfred está montando o plano de execução.',
  delegado: 'Alfred distribuiu as tarefas para a equipe.',
  executando: 'A equipe está executando.',
  aguardando_aprovacao: 'Aguardando sua aprovação.',
  validando: 'Alfred está validando e consolidando a entrega.',
  concluido: 'Execução concluída.',
  falhou: 'A execução falhou.',
  cancelado: 'Execução cancelada.',
};
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[...truncado]` : s);

class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/**
 * Motor de execução do Alfred. Todo o estado vive no SQLite, então a interface pode fechar e o processo
 * pode reiniciar: `recover()` retoma execuções interrompidas a partir das tarefas já concluídas.
 */
export class Engine {
  private queue: string[] = [];
  private running = new Map<string, AbortController>();
  private taskSlots: Semaphore;
  private idle: Array<() => void> = [];

  constructor(private s: Services) {
    this.taskSlots = new Semaphore(s.config.maxParallelTasks);
  }

  // ---------- entrada ----------

  workspace(conversationId: string) {
    const dir = path.join(this.s.config.dataDir, 'workspaces', conversationId);
    for (const sub of ['entrada', 'entregas']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    return dir;
  }

  /** Registra a mensagem do usuário e cria a execução. Idempotente por clientRequestId. */
  submit(input: { conversationId?: string; text: string; attachments?: Attachment[]; clientRequestId?: string }) {
    const { db } = this.s;
    const text = input.text.trim();
    if (!text) throw new Error('Mensagem vazia.');
    if (text.length > 20_000) throw new Error('Mensagem acima de 20.000 caracteres.');
    if (input.clientRequestId) {
      const dup = db.get<{ execution_id: string; conversation_id: string }>(
        'SELECT execution_id, conversation_id FROM messages WHERE client_request_id = :r', { r: input.clientRequestId });
      if (dup) return { conversationId: dup.conversation_id, executionId: dup.execution_id, duplicate: true };
    }
    const ts = now();
    let conversationId = input.conversationId;
    if (!conversationId || !db.get('SELECT id FROM conversations WHERE id = :id', { id: conversationId })) {
      conversationId = newId();
      db.insert('conversations', { id: conversationId, title: text.slice(0, 60), created_at: ts, updated_at: ts });
    } else db.update('conversations', conversationId, { updated_at: ts });

    const ws = this.workspace(conversationId);
    const attachments: Attachment[] = [];
    for (const a of input.attachments ?? []) {
      const up = db.get<{ name: string; rel_path: string }>('SELECT name, rel_path FROM uploads WHERE id = :id', { id: a.id });
      if (!up) continue;
      fs.copyFileSync(path.join(this.s.config.dataDir, up.rel_path), path.join(ws, 'entrada', up.name));
      attachments.push({ id: a.id, name: up.name });
    }
    const executionId = newId();
    db.insert('executions', { id: executionId, conversation_id: conversationId, request: text, status: 'recebido', created_at: ts, updated_at: ts });
    db.insert('messages', {
      id: newId(), conversation_id: conversationId, role: 'user', content: text, attachments: JSON.stringify(attachments),
      execution_id: executionId, client_request_id: input.clientRequestId ?? null, created_at: ts,
    });
    db.audit('usuario', 'mensagem', { conversationId, executionId });
    this.s.bus.emit({ executionId, type: 'status', message: STATUS_TEXT.recebido, data: { status: 'recebido', conversationId } });
    this.enqueue(executionId);
    return { conversationId, executionId, duplicate: false };
  }

  /** Retoma execuções interrompidas por queda/reinício do processo. */
  recover() {
    const { db } = this.s;
    const open = db.all<ExecutionRow>(`SELECT * FROM executions WHERE status NOT IN ('concluido','falhou','cancelado','aguardando_aprovacao') ORDER BY created_at`);
    for (const e of open) {
      db.run(`UPDATE tasks SET status = 'pendente' WHERE execution_id = :e AND status = 'executando'`, { e: e.id });
      this.s.bus.emit({ executionId: e.id, type: 'log', message: 'Execução retomada após reinício do sistema.' });
      this.enqueue(e.id);
    }
    return open.length;
  }

  cancel(executionId: string) {
    const e = this.execution(executionId);
    if (!e || TERMINAL.includes(e.status)) return false;
    this.queue = this.queue.filter((id) => id !== executionId);
    this.s.db.run(`UPDATE tasks SET status = 'cancelada', finished_at = :t WHERE execution_id = :e AND status IN ('pendente','executando')`, { e: executionId, t: now() });
    this.setStatus(executionId, 'cancelado');
    this.running.get(executionId)?.abort();
    this.s.db.audit('usuario', 'cancelar_execucao', { executionId });
    return true;
  }

  /** Aguarda a fila esvaziar (usado em testes e no encerramento gracioso). */
  async whenIdle() {
    if (!this.queue.length && !this.running.size) return;
    await new Promise<void>((r) => this.idle.push(r));
  }

  // ---------- fila ----------

  private enqueue(id: string) {
    if (this.queue.includes(id) || this.running.has(id)) return;
    this.queue.push(id);
    this.pump();
  }

  private pump() {
    while (this.running.size < this.s.config.maxParallelExecutions && this.queue.length) {
      const id = this.queue.shift()!;
      const ac = new AbortController();
      this.running.set(id, ac);
      void this.runExecution(id, ac.signal)
        .catch((err) => this.fail(id, err))
        .finally(() => {
          this.running.delete(id);
          this.pump();
          if (!this.queue.length && !this.running.size) this.idle.splice(0).forEach((r) => r());
        });
    }
  }

  private execution(id: string) {
    return this.s.db.get<ExecutionRow>('SELECT * FROM executions WHERE id = :id', { id });
  }
  private tasks(executionId: string) {
    return this.s.db.all<TaskRow>('SELECT * FROM tasks WHERE execution_id = :e ORDER BY rowid', { e: executionId });
  }

  private setStatus(id: string, status: ExecutionStatus, extra: Record<string, string | number | null> = {}) {
    const ts = now();
    this.s.db.update('executions', id, { status, updated_at: ts, ...(TERMINAL.includes(status) ? { finished_at: ts } : {}), ...extra });
    this.s.bus.emit({ executionId: id, type: 'status', message: STATUS_TEXT[status], data: { status } });
  }

  private addCost(executionId: string, usd: number) {
    if (usd > 0) this.s.db.run('UPDATE executions SET cost_usd = cost_usd + :c WHERE id = :id', { c: usd, id: executionId });
  }
  private spentToday() {
    return this.s.db.get<{ c: number }>(`SELECT COALESCE(SUM(cost_usd),0) AS c FROM executions WHERE created_at >= :d`, { d: now().slice(0, 10) })?.c ?? 0;
  }

  private fail(id: string, err: unknown) {
    const e = this.execution(id);
    if (!e || TERMINAL.includes(e.status)) return;
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof RuntimeError) this.addCost(id, err.costUsd);
    this.s.bus.emit({ executionId: id, type: 'erro', message });
    this.setStatus(id, 'falhou', { error: message });
    this.reply(e, `Não consegui concluir esta execução.\n\n**Motivo:** ${message}\n\nNada foi marcado como entregue. Você pode ajustar o pedido e enviar novamente.`);
  }

  private reply(e: ExecutionRow, content: string) {
    this.s.db.insert('messages', { id: newId(), conversation_id: e.conversation_id, role: 'assistant', content, execution_id: e.id, created_at: now() });
    this.s.bus.emit({ executionId: e.id, type: 'mensagem', message: 'Alfred respondeu.', data: { conversationId: e.conversation_id } });
  }

  // ---------- ciclo da execução ----------

  private async runExecution(id: string, signal: AbortSignal) {
    let e = this.execution(id)!;
    if (TERMINAL.includes(e.status)) return;
    if (this.spentToday() >= this.s.config.maxCostPerDay) {
      throw new RuntimeError(`Limite diário de custo atingido (US$ ${this.s.config.maxCostPerDay}). Ajuste MD2_MAX_COST_USD_PER_DAY ou aguarde o próximo dia.`, false);
    }
    const status = await this.s.runtime.status();
    if (!status.ready) throw new RuntimeError(status.detail, false);

    if (!e.plan) {
      const plan = await this.plan(e, signal);
      if (signal.aborted) return;
      this.s.db.update('conversations', e.conversation_id, { title: plan.titulo.slice(0, 80) || e.request.slice(0, 60) });
      this.s.db.update('executions', id, { plan: JSON.stringify(plan), objective: plan.objetivo });
      if (plan.modo === 'resposta_direta') {
        this.setStatus(id, 'concluido', { summary: plan.resposta });
        this.reply(e, plan.resposta);
        return;
      }
      for (const t of plan.tarefas) {
        this.s.db.insert('tasks', {
          id: newId(), execution_id: id, key: t.chave, agent_id: t.agente, title: t.titulo, instructions: t.instrucoes,
          depends_on: JSON.stringify(t.depende_de), skills: JSON.stringify(t.skills), status: 'pendente',
        });
      }
      this.s.bus.emit({ executionId: id, type: 'plano', message: `Plano definido: ${plan.tarefas.length} tarefa(s). ${plan.resposta}`, data: { objetivo: plan.objetivo } });
      this.setStatus(id, 'delegado');
      for (const t of plan.tarefas) {
        const a = this.s.agents.get(t.agente)!;
        this.s.bus.emit({ executionId: id, agentId: a.id, type: 'tarefa', message: `Alfred delegou a ${a.name}: ${t.titulo}` });
      }
    }

    for (;;) {
      this.setStatus(id, 'executando');
      await this.runTasks(id, signal);
      if (signal.aborted) return;
      this.setStatus(id, 'validando');
      e = this.execution(id)!;
      const review = await this.review(e, signal);
      if (signal.aborted) return;
      const fixable = review.correcoes.filter((c) => this.tasks(id).some((t) => t.key === c.chave));
      if (!review.aprovado && fixable.length && e.correction_rounds < 1) {
        this.s.db.update('executions', id, { correction_rounds: e.correction_rounds + 1 });
        for (const c of fixable) {
          const t = this.tasks(id).find((x) => x.key === c.chave)!;
          this.s.db.update('tasks', t.id, {
            status: 'pendente', attempt: 0, error: null,
            instructions: `${t.instructions}\n\n## Correção solicitada por Alfred após a validação\n${c.instrucoes}`,
          });
          this.s.bus.emit({ executionId: id, taskId: t.id, agentId: t.agent_id, type: 'tarefa', message: `Alfred solicitou correção a ${this.s.agents.get(t.agent_id)?.name}: ${clip(c.instrucoes, 200)}` });
        }
        continue;
      }
      const tasks = this.tasks(id);
      const allFailed = tasks.every((t) => t.status !== 'concluida');
      const pendingApprovals = this.s.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE execution_id = :e AND status = 'pendente'`, { e: id })!.n;
      this.reply(e, review.resposta_final);
      if (allFailed) this.setStatus(id, 'falhou', { summary: review.resposta_final, error: 'Nenhuma tarefa foi concluída.' });
      else this.setStatus(id, pendingApprovals ? 'aguardando_aprovacao' : 'concluido', { summary: review.resposta_final });
      return;
    }
  }

  private conversationContext(e: ExecutionRow) {
    const msgs = this.s.db
      .all<{ role: string; content: string }>('SELECT role, content FROM messages WHERE conversation_id = :c AND (execution_id IS NULL OR execution_id != :e) ORDER BY created_at DESC LIMIT 10', { c: e.conversation_id, e: e.id })
      .reverse();
    const history = msgs.map((m) => `${m.role === 'user' ? 'Usuário' : 'Alfred'}: ${clip(m.content, 1500)}`).join('\n\n');
    const ws = this.workspace(e.conversation_id);
    const tree: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 2 || tree.length > 80) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
        const rel = path.relative(ws, path.join(dir, ent.name));
        tree.push(ent.isDirectory() ? `${rel}/` : rel);
        if (ent.isDirectory()) walk(path.join(dir, ent.name), depth + 1);
      }
    };
    walk(ws, 0);
    const delivered = this.s.deliverables.list({ conversationId: e.conversation_id }).map((d) => `- ${d.name} (${d.category}, v${d.versions[0]?.version ?? 1}, ${d.status})`);
    return { history, tree, delivered, ws };
  }

  private async plan(e: ExecutionRow, signal: AbortSignal): Promise<Plan> {
    this.setStatus(e.id, 'analisando');
    const ctx = this.conversationContext(e);
    const hits = this.s.knowledge.search(e.request, { limit: 4 });
    if (hits.length) this.s.bus.emit({ executionId: e.id, type: 'log', message: `Alfred consultou o conhecimento: ${[...new Set(hits.map((h) => h.docId))].join(', ')}` });
    const pending = this.s.tools.tools.filter((t) => t.status !== 'disponivel').map((t) => `- ${t.name}: ${t.detail}`);
    const prompt = [
      ctx.history && `## Conversa até aqui\n${ctx.history}`,
      ctx.delivered.length && `## Entregáveis já registrados nesta conversa\n${ctx.delivered.join('\n')}`,
      ctx.tree.length && `## Arquivos no workspace da conversa\n${ctx.tree.join('\n')}`,
      this.s.config.authorizedDirs.length ? `## Pastas locais autorizadas para leitura\n${this.s.config.authorizedDirs.join('\n')}` : '## Pastas locais autorizadas para leitura\nNenhuma configurada (MD2_AUTHORIZED_DIRS). Os agentes só acessam arquivos enviados pelo usuário.',
      pending.length && `## Ferramentas NÃO disponíveis agora (não planeje depender delas)\n${pending.join('\n')}`,
      hits.length && `## Conhecimento relevante\n${hits.map((h) => `[${h.docId}] ${h.heading}: ${clip(h.text, 700)}`).join('\n\n')}`,
      `## Pedido do usuário\n${e.request}`,
    ].filter(Boolean).join('\n\n');

    this.setStatus(e.id, 'planejando');
    let feedback = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, costUsd } = await this.s.runtime.runStructured<Plan>({
        system: alfredSystem(this.s.agents, this.s.skills), prompt: prompt + feedback, schema: PLAN_SCHEMA, model: this.s.config.modelAlfred, signal,
      });
      this.addCost(e.id, costUsd);
      const errors = validatePlan(data, this.s.agents, this.s.skills);
      if (!errors.length) return data;
      feedback = `\n\n## Seu plano anterior foi rejeitado pela validação\n${errors.join('; ')}. Corrija e reenvie.`;
      this.s.bus.emit({ executionId: e.id, type: 'log', message: `Plano rejeitado na validação (${errors.join('; ')}). Alfred está refazendo.` });
    }
    throw new RuntimeError('Alfred não conseguiu montar um plano válido para este pedido.', false);
  }

  private async review(e: ExecutionRow, signal: AbortSignal): Promise<Review> {
    const tasks = this.tasks(e.id);
    const delivered = this.s.deliverables.list({ executionId: e.id }).map((d) => `- "${d.name}" (${d.category}, versão ${d.versions[0]?.version})`);
    const approvals = this.s.db.all<{ title: string; type: string; status: string }>('SELECT title, type, status FROM approvals WHERE execution_id = :e', { e: e.id });
    const prompt = [
      `## Pedido do usuário\n${e.request}`,
      `## Objetivo\n${e.objective ?? ''}`,
      `## Tarefas\n${tasks.map((t) => `### [${t.key}] ${this.s.agents.get(t.agent_id)?.name} — ${t.title}\nStatus: ${t.status}${t.error ? `\nErro: ${t.error}` : ''}\nResultado:\n${clip(t.result ?? '(sem resultado)', 5000)}`).join('\n\n')}`,
      `## Entregáveis registrados nesta execução\n${delivered.join('\n') || 'Nenhum.'}`,
      `## Pedidos de aprovação abertos\n${approvals.map((a) => `- ${a.title} (${a.type}, ${a.status})`).join('\n') || 'Nenhum.'}`,
      e.correction_rounds >= 1 ? 'Já houve uma rodada de correção. Não solicite outra: aprove e relate com fidelidade o que ficou pendente.' : '',
    ].join('\n\n');
    const { data, costUsd } = await this.s.runtime.runStructured<Review>({ system: reviewSystem(), prompt, schema: REVIEW_SCHEMA, model: this.s.config.modelAlfred, signal });
    this.addCost(e.id, costUsd);
    return data;
  }

  // ---------- tarefas ----------

  private async runTasks(executionId: string, signal: AbortSignal) {
    const inflight = new Map<string, Promise<void>>();
    for (;;) {
      if (signal.aborted) break;
      const tasks = this.tasks(executionId);
      const byKey = new Map(tasks.map((t) => [t.key, t]));
      for (const t of tasks) {
        if (t.status !== 'pendente' || inflight.has(t.id)) continue;
        const deps = (JSON.parse(t.depends_on) as string[]).map((k) => byKey.get(k)).filter((d): d is TaskRow => !!d);
        const blocked = deps.find((d) => d.status === 'falhou' || d.status === 'cancelada');
        if (blocked) {
          this.s.db.update('tasks', t.id, { status: 'cancelada', error: `Dependência não concluída: ${blocked.key}`, finished_at: now() });
          this.s.bus.emit({ executionId, taskId: t.id, agentId: t.agent_id, type: 'tarefa', message: `Tarefa "${t.title}" cancelada: depende de "${blocked.title}", que não foi concluída.`, data: { status: 'cancelada' } });
          continue;
        }
        if (deps.some((d) => d.status !== 'concluida')) continue;
        inflight.set(t.id, this.taskSlots.run(() => this.runTask(t.id, signal)).finally(() => inflight.delete(t.id)));
      }
      if (!inflight.size) {
        if (!this.tasks(executionId).some((t) => t.status === 'pendente')) break;
        continue;
      }
      await Promise.race(inflight.values());
    }
    await Promise.allSettled(inflight.values());
  }

  private async runTask(taskId: string, signal: AbortSignal) {
    const { db, bus, config } = this.s;
    const t = db.get<TaskRow>('SELECT * FROM tasks WHERE id = :id', { id: taskId })!;
    if (t.status !== 'pendente' || signal.aborted) return;
    const e = this.execution(t.execution_id)!;
    const agent = this.s.agents.get(t.agent_id)!;
    const remaining = config.maxCostPerExecution - e.cost_usd;
    if (remaining <= 0) {
      db.update('tasks', t.id, { status: 'falhou', error: `Limite de custo por execução atingido (US$ ${config.maxCostPerExecution}).`, finished_at: now() });
      bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: 'erro', message: `${agent.name} não iniciou "${t.title}": limite de custo da execução atingido.`, data: { status: 'falhou' } });
      return;
    }
    const attempt = t.attempt + 1;
    db.update('tasks', t.id, { status: 'executando', attempt, started_at: now(), error: null });
    bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: 'tarefa', message: `${agent.name} iniciou: ${t.title}${attempt > 1 ? ` (tentativa ${attempt})` : ''}`, data: { status: 'executando' } });

    const ws = this.workspace(e.conversation_id);
    const resolved = this.s.tools.resolve(agent.tools);
    const dept = this.s.agents.department(agent.department);
    const all = this.tasks(e.id);
    const deps = (JSON.parse(t.depends_on) as string[]).map((k) => all.find((x) => x.key === k)).filter((d): d is TaskRow => !!d);
    const inputs = fs.readdirSync(path.join(ws, 'entrada'));
    const skills = (JSON.parse(t.skills) as string[]).map((id) => this.s.skills.render(id)).filter(Boolean);
    const knowledge = this.s.knowledge.context(`${t.title} ${t.instructions}`, dept.knowledge);
    const prompt = [
      `# Tarefa: ${t.title}`,
      `Pedido original do usuário: ${clip(e.request, 3000)}`,
      `Objetivo da execução: ${e.objective ?? ''}`,
      `## Instruções de Alfred\n${t.instructions}`,
      t.error || attempt > 1 ? `## Atenção\nA tentativa anterior falhou${t.error ? `: ${t.error}` : ''}. Verifique o que já existe no workspace antes de refazer.` : '',
      deps.length ? `## Resultados das tarefas das quais você depende\n${deps.map((d) => `### [${d.key}] ${this.s.agents.get(d.agent_id)?.name} — ${d.title}\n${clip(d.result ?? '', 6000)}`).join('\n\n')}` : '',
      `## Workspace\nSeu diretório de trabalho é o workspace compartilhado desta conversa. Arquivos enviados pelo usuário ficam em entrada/ (${inputs.length ? inputs.join(', ') : 'vazio'}). Salve resultados finais em entregas/ e registre-os com a ferramenta registrar_entregavel.`,
      config.authorizedDirs.length ? `## Pastas locais autorizadas (somente leitura)\n${config.authorizedDirs.join('\n')}` : '',
      resolved.pending.length ? `## Ferramentas indisponíveis\n${resolved.pending.map((p) => `- ${p.name}: ${p.detail}`).join('\n')}\nNão simule o uso delas. Se forem indispensáveis, explique a lacuna na devolutiva.` : '',
      skills.length ? `## Skills atribuídas (siga as etapas e a validação)\n${skills.join('\n\n---\n\n')}` : '',
      knowledge ? `## Conhecimento da MD2 relevante para esta tarefa\n${knowledge}` : '',
      INJECTION_RULE,
    ].filter(Boolean).join('\n\n');

    const handlers: AgentToolHandlers = {
      registrarEntregavel: async (a) => {
        const d = this.s.deliverables.register({ ...a, conversationId: e.conversation_id, executionId: e.id, taskId: t.id, agentId: agent.id, workspace: ws });
        bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: 'entregavel', message: `${agent.name} registrou o entregável "${d.name}" (v${d.version}).`, data: d });
        return `Entregável "${d.name}" registrado como versão ${d.version}.`;
      },
      solicitarAprovacao: async (a) => {
        const id = newId();
        db.insert('approvals', { id, execution_id: e.id, task_id: t.id, agent_id: agent.id, type: a.tipo, title: a.titulo.slice(0, 200), description: a.descricao, payload: a.dados ?? null, status: 'pendente', created_at: now() });
        bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: 'aprovacao', message: `${agent.name} solicitou aprovação: ${a.titulo}`, data: { id } });
        return 'Pedido de aprovação registrado. NÃO execute a ação. Conclua sua tarefa informando que a ação aguarda aprovação do usuário.';
      },
      consultarConhecimento: async (a) => this.s.knowledge.context(a.consulta, [], 6000) || 'Nada encontrado na biblioteca para esta consulta.',
    };

    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, config.taskTimeoutMs);
    try {
      const res = await this.s.runtime.runAgent({
        system: this.s.agents.systemPrompt(agent), prompt, cwd: ws, sdkTools: resolved.sdkTools,
        readDirs: [...config.authorizedDirs, path.join(config.rootDir, 'skills'), path.join(config.rootDir, 'knowledge')],
        usePlaywright: resolved.usePlaywright, handlers, maxTurns: config.taskMaxTurns, maxBudgetUsd: remaining,
        model: config.modelAgents, resumeSessionId: attempt > 1 ? (t.session_id ?? undefined) : undefined, signal: ac.signal,
        onActivity: (a) => {
          if (a.kind === 'sessao') db.update('tasks', t.id, { session_id: a.sessionId ?? null });
          else bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: a.kind === 'ferramenta' ? 'atividade' : 'log', message: a.message, data: a.tool ? { tool: a.tool } : undefined });
        },
      });
      this.addCost(e.id, res.costUsd);
      if (signal.aborted) return;
      db.update('tasks', t.id, { status: 'concluida', result: res.text, cost_usd: t.cost_usd + res.costUsd, session_id: res.sessionId ?? t.session_id, finished_at: now() });
      bus.emit({ executionId: e.id, taskId: t.id, agentId: agent.id, type: 'tarefa', message: `${agent.name} concluiu: ${t.title}`, data: { status: 'concluida' } });
    } catch (err) {
      if (signal.aborted) return;
      const cost = err instanceof RuntimeError ? err.costUsd : 0;
      this.addCost(e.id, cost);
      const message = timedOut ? `Tempo limite de ${Math.round(config.taskTimeoutMs / 60000)} min excedido.` : err instanceof Error ? err.message : String(err);
      const retryable = !(err instanceof RuntimeError) || err.retryable;
      const retry = retryable && attempt < config.taskMaxAttempts;
      db.update('tasks', t.id, { status: retry ? 'pendente' : 'falhou', error: message, cost_usd: t.cost_usd + cost, finished_at: retry ? null : now() });
      bus.emit({
        executionId: e.id, taskId: t.id, agentId: agent.id, type: 'erro',
        message: retry ? `${agent.name} falhou em "${t.title}" (${message}). Alfred determinou nova tentativa.` : `${agent.name} não concluiu "${t.title}": ${message}`,
        data: { status: retry ? 'pendente' : 'falhou' },
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  // ---------- decisões humanas ----------

  decideApproval(id: string, decision: 'aprovar' | 'rejeitar', note?: string) {
    const { db, bus } = this.s;
    const a = db.get<{ id: string; execution_id: string | null; title: string; status: string; type: string }>('SELECT * FROM approvals WHERE id = :id', { id });
    if (!a) throw new Error('Aprovação não encontrada.');
    if (a.status !== 'pendente') throw new Error('Esta aprovação já foi decidida.');
    const approved = decision === 'aprovar';
    // Nenhum conector externo está implementado nesta versão: aprovar libera, mas não executa nada sozinho.
    const outcome = approved
      ? 'Aprovado. A integração que executaria esta ação ainda não está conectada, então nada foi publicado ou enviado automaticamente. Execute manualmente ou conecte a integração em Ferramentas.'
      : 'Rejeitado. Nenhuma ação foi executada.';
    db.update('approvals', id, { status: approved ? 'aprovado' : 'rejeitado', outcome, decision_note: note ?? null, decided_at: now() });
    db.audit('usuario', `aprovacao_${decision}`, { id, title: a.title, note });
    bus.emit({ executionId: a.execution_id, type: 'aprovacao', message: `Você ${approved ? 'aprovou' : 'rejeitou'}: ${a.title}. ${outcome}`, data: { id, status: approved ? 'aprovado' : 'rejeitado' } });
    if (a.execution_id) {
      const e = this.execution(a.execution_id);
      const pending = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE execution_id = :e AND status = 'pendente'`, { e: a.execution_id })!.n;
      if (e?.status === 'aguardando_aprovacao' && !pending) this.setStatus(e.id, 'concluido');
    }
    return { status: approved ? 'aprovado' : 'rejeitado', outcome };
  }

  decideDeliverable(id: string, decision: 'aprovar' | 'ajustar', note?: string) {
    const { db } = this.s;
    const d = db.get<{ id: string; name: string; conversation_id: string }>('SELECT id, name, conversation_id FROM deliverables WHERE id = :id', { id });
    if (!d) throw new Error('Entregável não encontrado.');
    if (decision === 'ajustar' && !note?.trim()) throw new Error('Descreva os ajustes desejados.');
    db.update('deliverables', id, { status: decision === 'aprovar' ? 'aprovado' : 'ajustes_solicitados', decision_note: note ?? null, updated_at: now() });
    db.audit('usuario', `entregavel_${decision}`, { id, name: d.name, note });
    this.s.bus.emit({ type: 'entregavel', message: decision === 'aprovar' ? `Você aprovou o entregável "${d.name}".` : `Você pediu ajustes em "${d.name}".`, data: { id } });
    if (decision === 'ajustar') return this.submit({ conversationId: d.conversation_id, text: `Ajustes no entregável "${d.name}": ${note!.trim()}` });
    return { conversationId: d.conversation_id };
  }
}
