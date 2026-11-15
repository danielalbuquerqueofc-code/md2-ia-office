import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { agentEnv, checkToolUse } from './guard.js';
import type { AgentRuntime, AgentToolHandlers, RunAgentOptions, RunAgentResult, RunStructuredOptions, RuntimeStatus } from './types.js';
import { RuntimeError } from './types.js';

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

/** Runtime de produção: cada tarefa é uma sessão independente do Claude Agent SDK, isolada no workspace. */
export class ClaudeAgentRuntime implements AgentRuntime {
  private cached?: { at: number; value: RuntimeStatus };

  private base(signal: AbortSignal, model?: string): Options {
    const abortController = new AbortController();
    if (signal.aborted) abortController.abort();
    else signal.addEventListener('abort', () => abortController.abort(), { once: true });
    return { abortController, model, settingSources: [], env: agentEnv(), persistSession: true };
  }

  async status(): Promise<RuntimeStatus> {
    if (this.cached && Date.now() - this.cached.at < 5 * 60_000) return this.cached.value;
    let value: RuntimeStatus;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 45_000);
      let ok = false;
      for await (const m of query({
        prompt: 'Responda apenas: ok',
        options: { ...this.base(ac.signal), tools: [], maxTurns: 1, systemPrompt: 'Verificação de conectividade.', persistSession: false },
      })) {
        if (m.type === 'result') ok = m.subtype === 'success' && !m.is_error;
      }
      clearTimeout(timer);
      value = ok
        ? { ready: true, detail: 'Claude Agent SDK autenticado e respondendo.' }
        : { ready: false, detail: 'O runtime respondeu com erro. Verifique ANTHROPIC_API_KEY ou o login do Claude Code.' };
    } catch (e) {
      value = { ready: false, detail: `Runtime indisponível: ${(e as Error).message}. Configure ANTHROPIC_API_KEY ou faça login no Claude Code.` };
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  async runStructured<T>(opts: RunStructuredOptions): Promise<{ data: T; costUsd: number }> {
    let cost = 0;
    for await (const m of query({
      prompt: opts.prompt,
      options: {
        ...this.base(opts.signal, opts.model),
        tools: [],
        maxTurns: 6,
        systemPrompt: opts.system,
        persistSession: false,
        outputFormat: { type: 'json_schema', schema: opts.schema },
      },
    })) {
      if (m.type !== 'result') continue;
      cost = m.total_cost_usd ?? 0;
      if (m.subtype === 'success' && m.structured_output) return { data: m.structured_output as T, costUsd: cost };
      throw new RuntimeError(`Alfred não conseguiu produzir uma resposta estruturada (${m.subtype}).`, true, cost);
    }
    throw new RuntimeError('O runtime encerrou sem resultado.', true, cost);
  }

  async runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
    const ctx = { workspace: opts.cwd, readDirs: opts.readDirs };
    const options: Options = {
      ...this.base(opts.signal, opts.model),
      cwd: opts.cwd,
      additionalDirectories: opts.readDirs,
      systemPrompt: opts.system,
      tools: [...opts.sdkTools, 'TodoWrite'],
      permissionMode: 'default',
      maxTurns: opts.maxTurns,
      maxBudgetUsd: opts.maxBudgetUsd,
      resume: opts.resumeSessionId,
      mcpServers: {
        md2: md2Server(opts.handlers),
        ...(opts.usePlaywright
          ? { playwright: { type: 'stdio' as const, command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'] } }
          : {}),
      },
      canUseTool: async (toolName, input) => {
        const d = checkToolUse(toolName, input, ctx);
        if (d.allow) return { behavior: 'allow', updatedInput: input };
        opts.onActivity({ kind: 'ferramenta', tool: toolName, message: `Bloqueado pelo guard de segurança: ${d.reason}` });
        return { behavior: 'deny', message: `Ação bloqueada pela política de segurança da MD2: ${d.reason}. Siga por outro caminho dentro do workspace ou solicite aprovação.` };
      },
    };

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
        if (m.subtype === 'success' && !m.is_error) return { text: m.result, costUsd, sessionId: m.session_id ?? sessionId };
        const why =
          m.subtype === 'error_max_turns' ? 'limite de etapas atingido'
          : m.subtype === 'error_max_budget_usd' ? 'limite de custo da tarefa atingido'
          : m.subtype === 'success' ? String(m.result).slice(0, 300)
          : 'erro durante a execução';
        throw new RuntimeError(`Sessão do agente terminou sem concluir: ${why}.`, m.subtype !== 'error_max_budget_usd', costUsd);
      }
    }
    throw new RuntimeError('A sessão do agente encerrou sem resultado.', true);
  }
}
