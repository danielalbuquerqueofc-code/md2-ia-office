import { spawnSync } from 'node:child_process';
import type { Config } from '../config.js';

export type ToolStatus = 'disponivel' | 'pendente' | 'indisponivel';
export interface ToolDef {
  id: string; name: string; category: string; description: string;
  /** Ferramentas nativas do Claude Agent SDK liberadas por este item. */
  sdkTools: string[];
  /** Operações externas que SEMPRE exigem aprovação humana antes de executar. */
  gatedActions: string[];
  status: ToolStatus; detail: string; howToEnable?: string;
}

const has = (bin: string, args = ['-version']) => {
  try { return spawnSync(bin, args, { stdio: 'ignore', timeout: 5000 }).status === 0; } catch { return false; }
};

/**
 * Tool Registry: fonte única do que cada agente pode usar. O status é detectado no ambiente real
 * (binários e variáveis de ambiente); nada é marcado como disponível sem verificação.
 */
export class ToolRegistry {
  readonly tools: ToolDef[];
  constructor(private config: Config, env: NodeJS.ProcessEnv = process.env, probe: typeof has = has) {
    // Integrações externas ficam "pendente" até existirem credenciais E conector implementado e testado.
    const cred = (ok: boolean, _okText: string, how: string): Pick<ToolDef, 'status' | 'detail' | 'howToEnable'> => ({
      status: 'pendente',
      detail: ok
        ? 'Credenciais detectadas, mas o conector desta integração ainda não foi implementado nesta versão.'
        : 'Credenciais não configuradas; conector ainda não implementado nesta versão.',
      howToEnable: how,
    });
    const ffmpeg = probe('ffmpeg') && probe('ffprobe');
    const whisper = probe('whisper', ['--help']);
    this.tools = [
      { id: 'arquivos', name: 'Arquivos do workspace', category: 'Claude Code', description: 'Ler, criar e editar arquivos dentro do workspace isolado da conversa.', sdkTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], gatedActions: [], status: 'disponivel', detail: 'Nativo do runtime.' },
      { id: 'shell', name: 'Execução de código', category: 'Claude Code', description: 'Executar comandos, scripts, builds e testes no workspace (com bloqueio de comandos destrutivos).', sdkTools: ['Bash'], gatedActions: [], status: 'disponivel', detail: 'Nativo do runtime, filtrado pelo guard de segurança.' },
      { id: 'web', name: 'Pesquisa e leitura web', category: 'Pesquisa', description: 'Buscar na web e ler páginas públicas (sites, Google Maps, perfis públicos).', sdkTools: ['WebSearch', 'WebFetch'], gatedActions: [], status: 'disponivel', detail: 'Nativo do runtime. Páginas com login (ex.: Instagram) podem não ser legíveis sem API oficial.' },
      { id: 'analise_imagem', name: 'Análise de imagens', category: 'IA', description: 'Interpretar fotos, logos e capturas de tela enviadas ou geradas.', sdkTools: ['Read'], gatedActions: [], status: 'disponivel', detail: 'Visão nativa do modelo via leitura de arquivos de imagem.' },
      { id: 'ffmpeg', name: 'FFmpeg', category: 'Audiovisual', description: 'Cortes, montagem, redimensionamento 9:16, legendas, áudio e exportação de vídeo.', sdkTools: ['Bash'], gatedActions: [], ...(ffmpeg ? { status: 'disponivel' as const, detail: 'ffmpeg e ffprobe encontrados no sistema.' } : { status: 'indisponivel' as const, detail: 'ffmpeg/ffprobe não encontrados.', howToEnable: 'Instale o FFmpeg e garanta que `ffmpeg` e `ffprobe` estejam no PATH.' }) },
      { id: 'playwright', name: 'Playwright (navegador)', category: 'Automação', description: 'Navegação automatizada, inspeção de páginas, capturas de tela e testes de interface.', sdkTools: [], gatedActions: [], ...(config.enablePlaywrightMcp ? { status: 'disponivel' as const, detail: 'Servidor MCP @playwright/mcp habilitado.' } : { status: 'pendente' as const, detail: 'Servidor MCP desabilitado.', howToEnable: 'Defina MD2_ENABLE_PLAYWRIGHT_MCP=1 (usa `npx @playwright/mcp`; requer Chromium instalado).' }) },
      { id: 'github', name: 'GitHub', category: 'Desenvolvimento', description: 'Repositórios, branches, commits e pull requests.', sdkTools: [], gatedActions: ['push', 'abrir pull request', 'merge'], ...cred(!!env.GITHUB_TOKEN, 'GITHUB_TOKEN configurado (uso via git/gh no shell).', 'Defina GITHUB_TOKEN com um token de acesso de escopo mínimo (repo).') },
      { id: 'google_drive', name: 'Google Drive', category: 'Google', description: 'Ler documentos autorizados, organizar e criar arquivos.', sdkTools: [], gatedActions: ['compartilhar arquivo', 'excluir arquivo'], ...cred(!!env.GOOGLE_OAUTH_REFRESH_TOKEN, 'OAuth Google configurado.', 'Crie um cliente OAuth no Google Cloud (Drive API) e defina GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN.') },
      { id: 'google_calendar', name: 'Google Calendar', category: 'Google', description: 'Agenda, reuniões, eventos e disponibilidade.', sdkTools: [], gatedActions: ['criar evento com convidados', 'cancelar evento'], ...cred(!!env.GOOGLE_OAUTH_REFRESH_TOKEN, 'OAuth Google configurado.', 'Mesmas credenciais OAuth do Google Drive, com a Calendar API ativada.') },
      { id: 'instagram', name: 'Instagram Graph API', category: 'Redes sociais', description: 'Publicação autorizada e métricas de contas profissionais.', sdkTools: [], gatedActions: ['publicar', 'responder comentário', 'excluir publicação'], ...cred(!!env.INSTAGRAM_ACCESS_TOKEN && !!env.INSTAGRAM_BUSINESS_ACCOUNT_ID, 'Token configurado.', 'Requer conta Instagram profissional vinculada a uma Página, app na Meta com permissões instagram_content_publish aprovadas, e as variáveis INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_BUSINESS_ACCOUNT_ID.') },
      { id: 'geracao_imagem', name: 'Geração de imagens', category: 'IA', description: 'Criar imagens por IA para peças e sites.', sdkTools: [], gatedActions: [], ...cred(!!env.IMAGE_GENERATION_API_KEY, 'Chave configurada.', 'Escolha um provedor de geração de imagens, defina IMAGE_GENERATION_API_KEY. Até lá os agentes usam apenas imagens fornecidas pelo cliente.') },
      { id: 'transcricao', name: 'Transcrição de áudio', category: 'IA', description: 'Transcrever falas de vídeos para legendas.', sdkTools: ['Bash'], gatedActions: [], ...(whisper ? { status: 'disponivel' as const, detail: 'CLI `whisper` encontrada.' } : { status: 'indisponivel' as const, detail: 'CLI `whisper` não encontrada.', howToEnable: 'Instale o openai-whisper (`pip install -U openai-whisper`) para legendas automáticas a partir da fala. Sem ele, legendas são escritas a partir do roteiro.' }) },
    ];
  }
  get(id: string) { return this.tools.find((t) => t.id === id); }

  /** Resolve as ferramentas de um agente em permissões concretas do SDK. Só entra o que está disponível. */
  resolve(toolIds: string[]) {
    const available = toolIds.map((id) => this.get(id)).filter((t): t is ToolDef => !!t && t.status === 'disponivel');
    const sdkTools = [...new Set(available.flatMap((t) => t.sdkTools))];
    const usePlaywright = available.some((t) => t.id === 'playwright') && this.config.enablePlaywrightMcp;
    const pending = toolIds.map((id) => this.get(id)).filter((t): t is ToolDef => !!t && t.status !== 'disponivel');
    return { sdkTools, usePlaywright, available, pending };
  }
}
