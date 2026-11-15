import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { log, redact } from '../logger.js';
import { agentEnv, checkToolUse } from './guard.js';
import type { SandboxStatus } from './sandbox.js';
import { buildSandbox, detectSandbox } from './sandbox.js';
import type { AgentRuntime, AgentToolHandlers, RunAgentOptions, RunAgentResult, RunStructuredOptions, RuntimeStatus, Usage } from './types.js';
import { isAccountLimit, RuntimeError } from './types.js';

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const guarded = async (fn: () => Promise<string>) => {
  try {
    return text(await fn());
  } catch (e) {
    return { ...text(`ERRO: ${(e as Error).message}`), isError: true };
  }
};

function md2Server(h: AgentToolHandlers) {
  return createSdkMcpServer({
    name: 'md2',
    version: '2.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'registrar_entregavel',
        'Registra um arquivo ou pasta do workspace como entregável na Central de Entregáveis. Para sites, informe a pasta que contém index.html. Use sempre que produzir um resultado final (site, vídeo, imagem, documento, proposta, relatório, campanha).',
        {
          caminho: z.string().describe('Caminho relativo ao workspace (arquivo ou pasta)'),
          nome: z.string().describe('Nome curto do entregável. Reutilize o mesmo nome para gerar nova versão.'),
          categoria: z.enum(['site', 'video', 'imagem', 'documento', 'proposta', 'relatorio', 'campanha', 'projeto', 'outro']),
          cliente: z.string().optional().describe('Cliente ou projeto'),
          observacoes: z.string().optional(),
        },
        (a) => guarded(() => h.registrarEntregavel(a)),
      ),
      tool(
        'solicitar_aprovacao',
        'Abre um pedido de aprovação humana para uma ação externa ou sensível (publicar, enviar proposta final ou comunicação externa, gastar, contratar, alterar dado financeiro, excluir algo de forma irreversível). Você NÃO executa a ação: prepare tudo, registre o pedido e conclua sua tarefa.',
        {
          tipo: z.enum(['publicacao', 'envio_proposta', 'comunicacao_externa', 'gasto', 'contratacao', 'alteracao_financeira', 'exclusao', 'outro']),
          titulo: z.string(),
          descricao: z.string().describe('O que será feito, onde, com qual conteúdo e qual o impacto'),
          dados: z.string().optional().describe('Dados necessários para executar depois (texto, legenda, caminho do arquivo, destinatário)'),
        },
        (a) => guarded(() => h.solicitarAprovacao(a)),
      ),
      tool(
        'consultar_conhecimento',
        'Busca na biblioteca de conhecimento da MD2 (métodos, checklists e padrões por departamento).',
        { consulta: z.string() },
        (a) => guarded(() => h.consultarConhecimento(a)),
      ),
    ],
  });
}

const TOOL_LABEL: Record<string, (i: Record<string, unknown>) => string> = {
  Read: (i) => `Lendo ${short(i.file_path)}`,
  Write: (i) => `Escrevendo ${short(i.file_path)}`,
  Edit: (i) => `Editando ${short(i.file_path)}`,
  Bash: (i) => `Executando: ${String(i.description ?? i.command ?? '').slice(0, 140)}`,
  Glob: (i) => `Procurando arquivos ${String(i.pattern ?? '')}`,
  Grep: (i) => `Buscando "${String(i.pattern ?? '')}"`,
  WebSearch: (i) => `Pesquisando na web: ${String(i.query ?? '')}`,
  WebFetch: (i) => `Lendo página ${String(i.url ?? '')}`,
  mcp__md2__registrar_entregavel: (i) => `Registrando entregável "${String(i.nome ?? '')}"`,
  mcp__md2__solicitar_aprovacao: (i) => `Solicitando aprovação: ${String(i.titulo ?? '')}`,
  mcp__md2__consultar_conhecimento: (i) => `Consultando conhecimento: ${String(i.consulta ?? '')}`,
};
const short = (p: unknown) => String(p ?? '').split('/').slice(-2).join('/');

type ResultMessage = Extract<SDKMessage, { type: 'result' }>;
function usageOf(m: ResultMessage): Usage {
  const all = Object.values(m.modelUsage ?? {});
  return {
    turns: m.num_turns ?? 0,
    inputTokens: all.reduce((s, u) => s + (u.inputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0),
    outputTokens: all.reduce((s, u) => s + (u.outputTokens ?? 0), 0),
    cacheReadTokens: all.reduce((s, u) => s + (u.cacheReadInputTokens ?? 0), 0),
  };
}

const RETRY_PROBE_MS = 2 * 60_000;
/** Versão fixada (nunca "latest"): atualizar é uma decisão revisada, não automática. Testada em 15/11/2026. */
const PLAYWRIGHT_MCP_VERSION = '0.0.85';

/** Runtime de produção: cada tarefa é uma sessão independente do Claude Agent SDK, isolada no workspace. */
export class ClaudeAgentRuntime implements AgentRuntime {
  private cached?: { at: number; value: RuntimeStatus };
  private probing?: Promise<RuntimeStatus>;
  private sandboxState: SandboxStatus;

  constructor(private config: Config) {
    this.sandboxState = detectSandbox(config);
  }

  peek() {
    return this.cached?.value ?? null;
  }

  sandbox() {
    return { active: this.sandboxState.active, mode: this.sandboxState.mode, detail: this.sandboxState.detail };
  }

  private base(signal: AbortSignal, model?: string, extraEnv: Record<string, string> = {}): Options {
    const abortController = new AbortController();
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', () => abortController.abort(), { once: true });
    return { abortController, model, settingSources: [], env: { ...agentEnv(), ...extraEnv }, persistSession: true };
  }

  /**
   * Verificação de conectividade. Custa uma chamada mínima ao modelo, então NÃO é repetida
   * periodicamente: fica em cache enquanto estiver saudável e só é refeita sob demanda (`force`)
   * ou, após uma falha, no máximo a cada 2 minutos.
   */
  async status(force = false): Promise<RuntimeStatus> {
    const c = this.cached;
    if (!force && c && (c.value.ready || Date.now() - c.at < RETRY_PROBE_MS)) return c.value;
    this.probing ??= this.probe().finally(() => { this.probing = undefined; });
    return this.probing;
  }

  private async probe(): Promise<RuntimeStatus> {
    let value: RuntimeStatus;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 45_000);
      let ok = false, text = '';
      for await (const m of query({
        prompt: 'Responda apenas: ok',
        options: { ...this.base(ac.signal), tools: [], maxTurns: 1, systemPrompt: 'Verificação de conectividade.', persistSession: false },
      })) {
        if (m.type === 'result') { ok = m.subtype === 'success' && !m.is_error; text = m.subtype === 'success' ? String(m.result) : ''; }
      }
      clearTimeout(timer);
      value = ok
        ? { ready: true, detail: 'Claude Agent SDK autenticado e respondendo.' }
        : isAccountLimit(text)
          ? { ready: false, accountLimit: true, detail: `Limite de uso da conta Claude atingido: ${text.slice(0, 160)}` }
          : { ready: false, detail: 'O runtime respondeu com erro. Verifique ANTHROPIC_API_KEY ou o login do Claude Code.' };
    } catch (e) {
      value = { ready: false, detail: `Runtime indisponível: ${(e as Error).message}. Configure ANTHROPIC_API_KEY ou faça login no Claude Code.` };
    }
    value.checkedAt = new Date().toISOString();
    this.cached = { at: Date.now(), value };
    log[value.ready ? 'info' : 'warn']('runtime_status', { ready: value.ready });
    return value;
  }

  /** Limite da conta: marca o runtime como indisponível (sem nova chamada) e sinaliza ao motor para aguardar. */
  private limitError(detail: string, cost: number, usage?: Usage) {
    this.cached = { at: Date.now(), value: { ready: false, accountLimit: true, checkedAt: new Date().toISOString(), detail: `Limite de uso da conta Claude atingido: ${detail}` } };
    log.warn('limite_da_conta', { detalhe: detail });
    return new RuntimeError(`Limite de uso da conta Claude atingido (${detail}).`, true, cost, usage, true);
  }

  async runStructured<T>(opts: RunStructuredOptions): Promise<{ data: T; costUsd: number }> {
    let cost = 0;
    for await (const m of query({
      prompt: opts.prompt,
      options: {
        ...this.base(opts.signal, opts.model),
        tools: [],
        maxTurns: 6,
        maxBudgetUsd: opts.maxBudgetUsd,
        systemPrompt: opts.system,
        persistSession: false,
        outputFormat: { type: 'json_schema', schema: opts.schema },
      },
    })) {
      if (m.type !== 'result') continue;
      cost = m.total_cost_usd ?? 0;
      if (m.subtype === 'success' && m.structured_output) return { data: m.structured_output as T, costUsd: cost };
      const detail = m.subtype === 'success' ? String(m.result).slice(0, 200) : m.subtype;
      if (isAccountLimit(detail)) throw this.limitError(detail, cost);
      throw new RuntimeError(`Alfred não conseguiu produzir uma resposta estruturada: ${detail}`, m.subtype !== 'error_max_budget_usd', cost);
    }
    throw new RuntimeError('O runtime encerrou sem resultado.', true, cost);
  }

  async runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
    const ctx = { workspace: opts.cwd, readDirs: opts.readDirs };
    // Diretório temporário curto e próprio da conversa. Não pode ficar dentro do workspace: caminhos
    // longos estouram o limite de ~108 caracteres de sockets Unix (o Chrome headless do QA não sobe).
    const tmp = path.join(os.tmpdir(), `md2-${createHash('sha256').update(opts.cwd).digest('hex').slice(0, 10)}`);
    fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
    const sb = this.sandboxState;
    const options: Options = {
      ...this.base(opts.signal, opts.model, { TMPDIR: tmp, TMP: tmp, TEMP: tmp }),
      cwd: opts.cwd,
      additionalDirectories: opts.readDirs,
      systemPrompt: opts.system,
      tools: [...opts.sdkTools, 'TodoWrite'],
      permissionMode: 'default',
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      resume: opts.resumeSessionId,
      ...(sb.active
        ? { sandbox: buildSandbox({ workspace: opts.cwd, dataDir: opts.dataDir, rootDir: this.config.rootDir, readDirs: opts.readDirs, required: sb.mode === 'required' }) }
        : {}),
      mcpServers: {
        md2: md2Server(opts.handlers),
        ...(opts.usePlaywright
          ? { playwright: { type: 'stdio' as const, command: 'npx', args: ['-y', `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, '--headless', '--isolated'] } }
          : {}),
      },
      canUseTool: async (toolName, input) => {
        const d = checkToolUse(toolName, input, ctx);
        if (d.allow) return { behavior: 'allow', updatedInput: input };
        const what = redact(String(input.command ?? input.file_path ?? input.url ?? input.host ?? input.path ?? '').slice(0, 300));
        opts.onActivity({ kind: 'bloqueio', tool: toolName, message: `Bloqueado pelo guard de segurança: ${d.reason}`, detail: what });
        return { behavior: 'deny', message: `Ação bloqueada pela política de segurança da MD2: ${d.reason}. Siga por outro caminho dentro do workspace ou solicite aprovação.` };
      },
    };
    if (this.config.agentSandbox === 'required' && !sb.active) {
      throw new RuntimeError(`Execução recusada: MD2_AGENT_SANDBOX=required e o isolamento não está disponível. ${sb.detail}`, false);
    }

    let sessionId: string | undefined;
    for await (const m of query({ prompt: opts.prompt, options })) {
      if (m.type === 'system' && m.subtype === 'init') {
        sessionId = m.session_id;
        opts.onActivity({ kind: 'sessao', message: 'Sessão iniciada', sessionId });
      } else if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type === 'text' && block.text.trim()) opts.onActivity({ kind: 'texto', message: block.text.trim().slice(0, 600) });
          else if (block.type === 'tool_use') {
            const input = (block.input ?? {}) as Record<string, unknown>;
            opts.onActivity({ kind: 'ferramenta', tool: block.name, message: TOOL_LABEL[block.name]?.(input) ?? `Usando ${block.name}` });
          }
        }
      } else if (m.type === 'result') {
        const costUsd = m.total_cost_usd ?? 0;
        const usage = usageOf(m);
        if (m.subtype === 'success' && !m.is_error) return { text: m.result, costUsd, sessionId: m.session_id ?? sessionId, usage };
        const why =
          m.subtype === 'error_max_turns' ? 'limite de etapas atingido'
          : m.subtype === 'error_max_budget_usd' ? 'limite de custo da tarefa atingido'
          : m.subtype === 'success' ? String(m.result).slice(0, 300)
          : 'erro durante a execução';
        if (isAccountLimit(why)) throw this.limitError(why, costUsd, usage);
        throw new RuntimeError(`Sessão do agente terminou sem concluir: ${why}.`, m.subtype !== 'error_max_budget_usd', costUsd, usage);
      }
    }
    throw new RuntimeError('A sessão do agente encerrou sem resultado.', true);
  }
}
