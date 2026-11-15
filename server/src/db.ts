import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const EXECUTION_STATUSES = [
  'recebido', 'analisando', 'planejando', 'delegado', 'executando',
  'aguardando_aprovacao', 'validando', 'concluido', 'falhou', 'cancelado',
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const TERMINAL: ExecutionStatus[] = ['concluido', 'falhou', 'cancelado'];
export type TaskStatus = 'pendente' | 'executando' | 'concluida' | 'falhou' | 'cancelada';

export interface ExecutionRow {
  id: string; conversation_id: string; request: string; status: ExecutionStatus;
  objective: string | null; plan: string | null; summary: string | null; error: string | null;
  cost_usd: number; correction_rounds: number; recoveries: number; created_at: string; updated_at: string; finished_at: string | null;
}
export interface TaskRow {
  id: string; execution_id: string; key: string; agent_id: string; title: string; instructions: string;
  depends_on: string; skills: string; status: TaskStatus; attempt: number; result: string | null;
  error: string | null; session_id: string | null; cost_usd: number; started_at: string | null; finished_at: string | null;
  turns: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; interruptions: number;
  expected_output: string | null; acceptance: string; cobrancas: number; check_note: string | null;
}
export interface EventRow {
  id: number; execution_id: string | null; task_id: string | null; agent_id: string | null;
  type: string; message: string; data: string | null; created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', execution_id TEXT, client_request_id TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL,
  objective TEXT, plan TEXT, summary TEXT, error TEXT, cost_usd REAL NOT NULL DEFAULT 0,
  correction_rounds INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, key TEXT NOT NULL, agent_id TEXT NOT NULL, title TEXT NOT NULL,
  instructions TEXT NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]', skills TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, result TEXT, error TEXT, session_id TEXT,
  cost_usd REAL NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, UNIQUE(execution_id, key));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, execution_id TEXT, task_id TEXT, agent_id TEXT,
  type TEXT NOT NULL, message TEXT NOT NULL, data TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_exec ON events(execution_id, id);
CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, execution_id TEXT, task_id TEXT, agent_id TEXT,
  name TEXT NOT NULL, category TEXT NOT NULL, client TEXT, status TEXT NOT NULL, notes TEXT,
  decision_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(conversation_id, name));
CREATE TABLE IF NOT EXISTS deliverable_versions (
  id TEXT PRIMARY KEY, deliverable_id TEXT NOT NULL, version INTEGER NOT NULL, rel_path TEXT NOT NULL,
  entry TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, execution_id TEXT, agent_id TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, execution_id TEXT, task_id TEXT, agent_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL, payload TEXT, status TEXT NOT NULL, outcome TEXT, decision_note TEXT,
  created_at TEXT NOT NULL, decided_at TEXT);
CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, rel_path TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, request TEXT NOT NULL, plan TEXT, errors TEXT, cost_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL);
`;

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

type Params = Record<string, string | number | null>;

export class Db {
  readonly sql: DatabaseSync;
  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.sql.exec(SCHEMA);
    this.migrate();
  }

  /** Migrações aditivas e idempotentes: só acrescentam colunas; nunca removem nem reescrevem dados. */
  private migrate() {
    const add = (table: string, column: string, ddl: string) => {
      const cols = this.sql.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    };
    add('executions', 'recoveries', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'turns', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'input_tokens', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'output_tokens', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'cache_read_tokens', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'interruptions', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'expected_output', 'TEXT');
    add('tasks', 'acceptance', "TEXT NOT NULL DEFAULT '[]'");
    add('tasks', 'cobrancas', 'INTEGER NOT NULL DEFAULT 0');
    add('tasks', 'check_note', 'TEXT');
    this.sql.exec('CREATE INDEX IF NOT EXISTS tasks_exec ON tasks(execution_id); CREATE INDEX IF NOT EXISTS executions_created ON executions(created_at);');
  }
  all<T>(q: string, p: Params = {}): T[] {
    return this.sql.prepare(q).all(p) as T[];
  }
  get<T>(q: string, p: Params = {}): T | undefined {
    return this.sql.prepare(q).get(p) as T | undefined;
  }
  run(q: string, p: Params = {}) {
    return this.sql.prepare(q).run(p);
  }
  insert(table: string, row: Params) {
    const keys = Object.keys(row);
    this.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((k) => ':' + k).join(',')})`, row);
  }
  update(table: string, id: string, patch: Params) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = :${k}`).join(', ')} WHERE id = :id`, { ...patch, id });
  }
  audit(actor: string, action: string, detail?: unknown) {
    this.insert('audit', { actor, action, detail: detail === undefined ? null : JSON.stringify(detail), created_at: now() });
  }
  close() {
    this.sql.close();
  }
}
