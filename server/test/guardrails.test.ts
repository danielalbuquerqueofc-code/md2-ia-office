import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ClaudeAgentRuntime } from '../src/runtime/claudeRuntime.js';
import { RuntimeError } from '../src/runtime/types.js';
import { plan, ROOT, setup } from './helpers.js';

describe('tetos de custo fixados (alterar exige decisão explícita do usuário)', () => {
  it('os padrões continuam US$ 5 por tarefa, US$ 15 por execução e US$ 60 por dia', () => {
    const c = loadConfig({}, ROOT);
    expect([c.maxCostPerTask, c.maxCostPerExecution, c.maxCostPerDay]).toEqual([5, 15, 60]);
  });
  it('.env.example não sugere tetos diferentes dos padrões', () => {
    const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toMatch(/^MD2_MAX_COST_USD_PER_TASK=5$/m);
    expect(env).toMatch(/^MD2_MAX_COST_USD_PER_EXECUTION=15$/m);
    expect(env).toMatch(/^MD2_MAX_COST_USD_PER_DAY=60$/m);
  });
});

describe('sandbox obrigatório (MD2_AGENT_SANDBOX=required)', () => {
  const realPath = process.env.PATH;
  afterEach(() => { process.env.PATH = realPath; });

  const runWithoutSandboxTools = async () => {
    process.env.PATH = '/nonexistent'; // sem bwrap nem socat
    const rt = new ClaudeAgentRuntime(loadConfig({ MD2_AGENT_SANDBOX: 'required' }, ROOT));
    process.env.PATH = realPath;
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-req-'));
    try {
      return { rt, err: await rt.runAgent({
        system: 's', prompt: 'p', cwd: ws, dataDir: ws, sdkTools: ['Bash'], readDirs: [], usePlaywright: false, maxTurns: 1,
        handlers: { registrarEntregavel: async () => '', solicitarAprovacao: async () => '', consultarConhecimento: async () => '' },
        signal: new AbortController().signal, onActivity: () => undefined,
      }).then(() => null, (e: unknown) => e) };
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };

  it('sem bubblewrap/socat o runtime recusa executar o agente, de forma definitiva e sem chamar o modelo', async () => {
    const { rt, err } = await runWithoutSandboxTools();
    expect(rt.sandbox()).toMatchObject({ active: false, mode: 'required' });
    expect(err).toBeInstanceOf(RuntimeError);
    expect((err as RuntimeError).retryable).toBe(false);
    expect((err as RuntimeError).message).toMatch(/Execução recusada: MD2_AGENT_SANDBOX=required/);
    expect((err as RuntimeError).costUsd).toBe(0);
  });

  it('no motor, a recusa vira falha definitiva da tarefa: sem retentativa e sem relatar sucesso', async () => {
    const t = setup();
    try {
      t.runtime.plans.push(plan([{ chave: 'a', agente: 'andre' }]));
      t.runtime.agentImpl = async () => { throw new RuntimeError('Execução recusada: MD2_AGENT_SANDBOX=required e o isolamento não está disponível.', false); };
      const { executionId } = t.engine.submit({ text: 'construa algo' });
      await t.engine.whenIdle();
      expect(t.tasks(executionId)[0]).toMatchObject({ status: 'falhou', attempt: 1 });
      expect(t.exec(executionId).status).toBe('falhou');
      expect(t.runtime.agentCalls).toHaveLength(1);
    } finally { t.cleanup(); }
  });

  it('o modo padrão (auto) não bloqueia, mas sinaliza; off desativa; valor inválido impede iniciar', () => {
    expect(loadConfig({}, ROOT).agentSandbox).toBe('auto');
    expect(loadConfig({ MD2_AGENT_SANDBOX: 'off' }, ROOT).agentSandbox).toBe('off');
    expect(() => loadConfig({ MD2_AGENT_SANDBOX: 'obrigatorio' }, ROOT)).toThrow(/auto, required ou off/);
  });
});
