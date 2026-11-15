import { EventEmitter } from 'node:events';
import type { Db, EventRow } from './db.js';
import { now } from './db.js';

export interface EventInput {
  executionId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  /** status | plano | tarefa | atividade | log | erro | entregavel | aprovacao | mensagem */
  type: string;
  message: string;
  data?: unknown;
}

/** Persiste cada evento e o distribui em tempo real. Eventos só são emitidos por ações reais do runtime. */
export class EventBus {
  private emitter = new EventEmitter();
  constructor(private db: Db) {
    this.emitter.setMaxListeners(200);
  }
  emit(e: EventInput): EventRow {
    const row = {
      execution_id: e.executionId ?? null,
      task_id: e.taskId ?? null,
      agent_id: e.agentId ?? null,
      type: e.type,
      message: e.message.slice(0, 2000),
      data: e.data === undefined ? null : JSON.stringify(e.data),
      created_at: now(),
    };
    const res = this.db.run(
      `INSERT INTO events (execution_id, task_id, agent_id, type, message, data, created_at)
       VALUES (:execution_id, :task_id, :agent_id, :type, :message, :data, :created_at)`,
      row,
    );
    const full: EventRow = { id: Number(res.lastInsertRowid), ...row };
    this.emitter.emit('event', full);
    return full;
  }
  subscribe(fn: (e: EventRow) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
  since(id: number, limit = 500): EventRow[] {
    return this.db.all<EventRow>('SELECT * FROM events WHERE id > :id ORDER BY id LIMIT :limit', { id, limit });
  }
}
