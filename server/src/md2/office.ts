import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

import { createAgentState } from '../agentState.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { CodexClient, type RpcMessage } from './codexClient.js';

export interface Md2Task {
  id: string;
  prompt: string;
  status: 'running' | 'approval' | 'completed' | 'failed' | 'interrupted';
  createdAt: string;
  agentId?: number;
  threadId?: string;
  turnId?: string;
  output: string;
  error?: string;
  events: string[];
  eventCounts?: Record<string, number>;
}
export interface Md2Approval {
  id: string;
  taskId: string;
  method: string;
  details: Record<string, unknown>;
  reviewable: boolean;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: string;
}
type Client = Pick<CodexClient, 'start' | 'request' | 'notify' | 'close'>;
type ClientOptions = ConstructorParameters<typeof CodexClient>[0];

/** One active programmer, a durable task ledger and single-use human decisions. */
export class Md2Office {
  private tasks: Md2Task[] = [];
  private approvals: Md2Approval[] = [];
  private decisions = new Map<
    string,
    { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private active:
    { task: Md2Task; client: Client; timer: ReturnType<typeof setTimeout> } | undefined;
  private disposed = false;
  private proposedChanges = new Map<string, unknown[]>();

  constructor(
    private readonly options: {
      store: AgentStateStore;
      cwd: string;
      command: string;
      ledger: string;
      approvalTimeoutMs?: number;
      taskTimeoutMs?: number;
      clientFactory?: (options: ClientOptions) => Client;
    },
  ) {
    if (existsSync(options.ledger)) {
      const saved = JSON.parse(readFileSync(options.ledger, 'utf8'));
      this.tasks = saved.tasks ?? [];
      this.approvals = saved.approvals ?? [];
      for (const task of this.tasks) {
        if (task.status === 'running' || task.status === 'approval') task.status = 'interrupted';
        delete task.agentId; // A ledger record does not resurrect a live character.
      }
      for (const approval of this.approvals)
        if (approval.status === 'pending') approval.status = 'expired';
      this.save();
    }
  }

  snapshot() {
    return {
      tasks: this.tasks,
      approvals: this.approvals,
      busy: !!this.active,
      workspace: this.options.cwd,
    };
  }

  async launch(prompt: string): Promise<Md2Task> {
    if (this.disposed) throw new Error('Escritório encerrado.');
    if (this.active) throw new Error('O programador já está executando uma tarefa.');
    const task: Md2Task = {
      id: randomUUID(),
      prompt,
      status: 'running',
      createdAt: new Date().toISOString(),
      output: '',
      events: [],
    };
    const client = (this.options.clientFactory ?? ((opts) => new CodexClient(opts)))({
      command: this.options.command,
      cwd: this.options.cwd,
      onEvent: (message) => this.event(task, message),
      onApproval: (message) => this.requestApproval(task, message),
      onExit: (error) => this.finish(task, 'failed', error.message),
    });
    const timer = setTimeout(
      () => this.finish(task, 'interrupted', 'Limite de duração atingido.'),
      this.options.taskTimeoutMs ?? 1800000,
    );
    this.active = { task, client, timer };
    this.tasks.unshift(task);
    this.save();
    try {
      client.start();
      await client.request('initialize', {
        clientInfo: { name: 'md2_ia_office', title: 'MD2 IA Office', version: '0.2.0' },
      });
      client.notify('initialized');
      const configuration = await client.request('config/read', { includeLayers: false });
      const disabledServers = Object.fromEntries(
        Object.keys(configuration.config?.mcp_servers ?? {}).map((name) => [
          name,
          { enabled: false },
        ]),
      );
      const result = await client.request('thread/start', {
        cwd: this.options.cwd,
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
        config: { mcp_servers: disabledServers },
      });
      if (this.active?.task !== task) throw new Error('Tarefa encerrada durante a conexão.');
      if (typeof result.thread?.id !== 'string')
        throw new Error('Codex não retornou uma sessão válida.');
      task.threadId = result.thread.id;
      const id = this.options.store.nextAgentId.current++;
      task.agentId = id;
      const agent = createAgentState({
        id,
        sessionId: task.threadId!,
        projectDir: this.options.cwd,
        jsonlFile: '',
        isExternal: true,
        hooksOnly: true,
        hookDelivered: true,
        providerId: 'codex',
        directoryName: 'Tecnologia · Codex',
        palette: 0,
      });
      this.options.store.set(id, agent);
      const turn = await client.request('turn/start', {
        threadId: task.threadId,
        input: [{ type: 'text', text: prompt }],
      });
      task.turnId = turn.turn?.id;
      this.save();
    } catch (error) {
      this.finish(task, 'failed', error instanceof Error ? error.message : String(error));
    }
    return task;
  }

  decide(id: string, decision: 'accept' | 'decline'): boolean {
    const approval = this.approvals.find((item) => item.id === id);
    const pending = this.decisions.get(id);
    if (!approval || approval.status !== 'pending' || !pending) return false;
    if (decision === 'accept' && !approval.reviewable) return false;
    approval.status = decision === 'accept' ? 'accepted' : 'declined';
    clearTimeout(pending.timer);
    this.decisions.delete(id);
    this.save(); // Persist the decision before returning permission to the agent.
    pending.resolve(decision === 'accept');
    return true;
  }

  cancel(id: string): boolean {
    if (this.active?.task.id !== id) return false;
    this.finish(this.active.task, 'interrupted', 'Cancelada pelo usuário.');
    return true;
  }

  dispose(): void {
    this.disposed = true;
    if (this.active) this.finish(this.active.task, 'interrupted', 'Servidor encerrado.');
  }

  private async requestApproval(
    task: Md2Task,
    message: RpcMessage,
  ): Promise<Record<string, unknown>> {
    if (message.method === 'item/permissions/requestApproval')
      return { permissions: {}, scope: 'turn' };
    if (
      !['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(
        message.method,
      )
    )
      throw new Error('Pedido não suportado.');
    if (this.active?.task !== task) return { decision: 'decline' };
    const params = message.params ?? {};
    const changes = this.proposedChanges.get(String(params.itemId));
    const denied =
      Array.isArray(params.availableDecisions) && !params.availableDecisions.includes('decline')
        ? 'cancel'
        : 'decline';
    const approval: Md2Approval = {
      id: randomUUID(),
      taskId: task.id,
      method: message.method,
      details: { ...params, ...(changes ? { changes } : {}) },
      reviewable: message.method.includes('fileChange')
        ? !!changes?.length
        : typeof params.command === 'string',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.approvals.unshift(approval);
    task.status = 'approval';
    if (task.agentId)
      this.options.store.broadcast({ type: 'agentToolPermission', id: task.agentId });
    const accepted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        approval.status = 'expired';
        this.decisions.delete(approval.id);
        this.save();
        resolve(false);
      }, this.options.approvalTimeoutMs ?? 120000);
      this.decisions.set(approval.id, { resolve, timer });
      this.save();
    });
    if (this.active?.task !== task) return { decision: denied };
    task.status = this.approvals.some((a) => a.taskId === task.id && a.status === 'pending')
      ? 'approval'
      : 'running';
    this.save();
    if (task.status !== 'approval' && task.agentId)
      this.options.store.broadcast({ type: 'agentToolPermissionClear', id: task.agentId });
    return { decision: accepted ? 'accept' : denied };
  }

  private event(task: Md2Task, message: RpcMessage): void {
    if (this.active?.task !== task) return;
    task.events = [message.method, ...task.events].slice(0, 12);
    task.eventCounts ??= {};
    task.eventCounts[message.method] = (task.eventCounts[message.method] ?? 0) + 1;
    const params = message.params ?? {};
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      task.output = (task.output + params.delta).slice(-50000);
    }
    const item = params.item as Record<string, unknown> | undefined;
    if (item?.type === 'fileChange' && Array.isArray(item.changes) && item.changes.length) {
      this.proposedChanges.set(String(item.id), item.changes);
    }
    const store = this.options.store;
    const agent = task.agentId ? store.get(task.agentId) : undefined;
    if (
      agent &&
      item &&
      ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'].includes(String(item.type))
    ) {
      const toolId = String(item.id);
      if (message.method === 'item/started') {
        const toolName =
          item.type === 'fileChange' ? 'Edit' : item.type === 'webSearch' ? 'WebSearch' : 'Bash';
        const status =
          item.type === 'fileChange'
            ? 'Editando arquivos'
            : String(item.command ?? 'Executando tarefa');
        agent.activeToolIds.add(toolId);
        agent.activeToolNames.set(toolId, toolName);
        agent.activeToolStatuses.set(toolId, status);
        agent.hadToolsInTurn = true;
        agent.isWaiting = false;
        store.broadcast({ type: 'agentToolStart', id: agent.id, toolId, toolName, status });
        store.broadcast({ type: 'agentStatus', id: agent.id, status: 'active' });
      } else if (message.method === 'item/completed') {
        agent.activeToolIds.delete(toolId);
        agent.activeToolNames.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        store.broadcast({ type: 'agentToolDone', id: agent.id, toolId });
      }
    }
    if (
      message.method === 'item/completed' &&
      item?.type === 'agentMessage' &&
      typeof item.text === 'string' &&
      !task.output
    )
      task.output = item.text.slice(-50000);
    if (message.method === 'turn/completed') {
      const turn = params.turn as { status?: string; error?: { message?: string } } | undefined;
      this.finish(
        task,
        turn?.status === 'completed'
          ? 'completed'
          : turn?.status === 'interrupted'
            ? 'interrupted'
            : 'failed',
        turn?.error?.message,
      );
    } else this.save();
  }

  private finish(task: Md2Task, status: Md2Task['status'], error?: string): void {
    if (this.active?.task !== task) return;
    const active = this.active;
    this.active = undefined;
    clearTimeout(active.timer);
    task.status = status;
    task.error = error;
    for (const approval of this.approvals.filter(
      (a) => a.taskId === task.id && a.status === 'pending',
    )) {
      approval.status = 'expired';
      const pending = this.decisions.get(approval.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(false);
        this.decisions.delete(approval.id);
      }
    }
    if (task.agentId) {
      const agent = this.options.store.get(task.agentId);
      if (agent) {
        agent.isWaiting = true;
        agent.activeToolIds.clear();
        agent.activeToolNames.clear();
        agent.activeToolStatuses.clear();
      }
      this.options.store.broadcast({ type: 'agentToolsClear', id: task.agentId });
      this.options.store.broadcast({ type: 'agentStatus', id: task.agentId, status: 'waiting' });
    }
    this.proposedChanges.clear();
    if (task.agentId)
      this.options.store.broadcast({ type: 'agentToolPermissionClear', id: task.agentId });
    active.client.close();
    this.save();
  }

  private save(): void {
    mkdirSync(path.dirname(this.options.ledger), { recursive: true });
    const temporary = this.options.ledger + '.tmp';
    writeFileSync(temporary, JSON.stringify({ tasks: this.tasks, approvals: this.approvals }), {
      mode: 0o600,
    });
    renameSync(temporary, this.options.ledger);
  }
}
