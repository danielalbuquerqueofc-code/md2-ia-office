import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import type { Plan, Review } from '../src/orchestrator/alfred.js';
import type { AgentRuntime, RunAgentOptions, RunAgentResult, RunStructuredOptions } from '../src/runtime/types.js';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * DUBLÊ DE TESTE — existe somente em server/test. Substitui o Claude Agent SDK para exercitar o motor
 * de forma determinística. Nunca é carregado pelo servidor real (ver server/src/index.ts).
 */
export class FakeRuntime implements AgentRuntime {
  ready = true;
  plans: Plan[] = [];
  reviews: Review[] = [];
  agentImpl: (o: RunAgentOptions) => Promise<RunAgentResult> = async (o) => ({ text: `feito: ${o.prompt.split('\n')[0]}`, costUsd: 0.01 });
  agentCalls: RunAgentOptions[] = [];
  structuredCalls: RunStructuredOptions[] = [];

  sandboxActive = false;
  peek() {
    return { ready: this.ready, detail: 'dublê de teste' };
  }
  sandbox() {
    return { active: this.sandboxActive, mode: 'auto', detail: 'dublê de teste' };
  }
  accountLimit = false;
  statusCalls = 0;
  async status() {
    this.statusCalls++;
    return this.ready ? { ready: true, detail: 'dublê de teste' } : { ready: false, detail: 'Runtime indisponível (teste).', accountLimit: this.accountLimit };
  }
  async runStructured<T>(o: RunStructuredOptions) {
    this.structuredCalls.push(o);
    const isPlan = 'modo' in (o.schema as { properties: Record<string, unknown> }).properties;
    const data = isPlan ? this.plans.shift() : (this.reviews.shift() ?? { aprovado: true, correcoes: [], resposta_final: 'Entrega consolidada.' });
    if (!data) throw new Error('FakeRuntime: sem plano roteirizado');
    return { data: data as T, costUsd: 0.001 };
  }
  async runAgent(o: RunAgentOptions) {
    this.agentCalls.push(o);
    return this.agentImpl(o);
  }
}

export function plan(tarefas: Array<Partial<Plan['tarefas'][number]> & { chave: string; agente: string }>): Plan {
  return {
    modo: 'plano', titulo: 'Teste', objetivo: 'Objetivo de teste', resposta: 'Vou executar.',
    tarefas: tarefas.map((t) => ({ titulo: `Tarefa ${t.chave}`, instrucoes: 'Faça.', depende_de: [], skills: [], ...t })),
  };
}

export function setup(env: Record<string, string> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-test-'));
  const config = loadConfig({ MD2_DATA_DIR: dataDir, MD2_BACKUP_DIR: `${dataDir}-backups`, MD2_TASK_MAX_ATTEMPTS: '2', ...env }, ROOT);
  const runtime = new FakeRuntime();
  const { services, engine } = bootstrap(config, runtime);
  const cleanup = () => { services.db.close(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(`${dataDir}-backups`, { recursive: true, force: true }); };
  const exec = (id: string) => services.db.get<{ status: string; error: string | null; cost_usd: number; summary: string | null }>('SELECT * FROM executions WHERE id = :id', { id })!;
  const tasks = (id: string) => services.db.all<{ key: string; status: string; attempt: number; error: string | null; instructions: string }>('SELECT * FROM tasks WHERE execution_id = :id ORDER BY rowid', { id });
  const events = (id: string) => services.db.all<{ type: string; message: string }>('SELECT type, message FROM events WHERE execution_id = :id ORDER BY id', { id });
  return { config, runtime, services, engine, cleanup, exec, tasks, events, dataDir };
}
