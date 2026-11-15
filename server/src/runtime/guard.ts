import fs from 'node:fs';
import path from 'node:path';

export interface GuardContext { workspace: string; readDirs: string[] }
export type GuardDecision = { allow: true } | { allow: false; reason: string };

const deny = (reason: string): GuardDecision => ({ allow: false, reason });
/**
 * Resolve o caminho real seguindo links simbólicos, inclusive quando o arquivo final ainda não existe
 * (usa o maior ancestral existente). Impede escapar do workspace por um symlink criado pelo agente.
 */
export function realResolve(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

const inside = (file: string, dir: string) => {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Comandos que nunca rodam sem um humano: destrutivos, de publicação/deploy, de escalonamento ou de exfiltração. */
const BASH_DENY: Array<[RegExp, string]> = [
  [/\bsudo\b|\bsu\s+-/, 'escalonamento de privilégio'],
  [/\brm\s+(-[a-zA-Z]*\s+)*(\/|~|\$HOME|\.\.)(\s|\/|$)/, 'exclusão fora do workspace'],
  [/\b(mkfs|shutdown|reboot|halt|poweroff)\b|\bdd\s+[^|]*of=\/dev\//, 'comando destrutivo de sistema'],
  [/:\(\)\s*\{.*\};\s*:/, 'fork bomb'],
  [/\b(chmod|chown)\s+-R\s+\S+\s+(\/|~)(\s|$)/, 'alteração recursiva de permissões do sistema'],
  [/\bgit\s+push\b|\bgh\s+(pr|release|repo)\s+(create|merge|delete)\b/, 'publicação em repositório remoto exige aprovação'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\b(vercel|netlify|firebase|wrangler|flyctl|heroku)\b.*\b(deploy|--prod|publish)\b/, 'deploy/publicação exige aprovação'],
  [/\b(curl|wget)\b[^|;]*\|\s*(ba|z)?sh\b/, 'execução de script remoto'],
  [/\b(ssh|scp|sftp|rsync)\s+\S*@/, 'acesso remoto a outras máquinas'],
  [/\b(printenv|env)\s*($|\|)|\/proc\/(\d+|self)\/?environ|\.env\b|\.ssh\/|\.aws\/|\.claude\/|credentials|ANTHROPIC_|_TOKEN\b|API_KEY|\bdeclare\s+-x|\bexport\s+-p\b|\bset\s*($|\|)/, 'acesso a credenciais'],
  [/\bcrontab\b|\bsystemctl\b|\blaunchctl\b/, 'alteração de serviços do sistema'],
];

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.(local|internal)$)/i;

export function isPrivateUrl(raw: string): boolean {
  try {
    return PRIVATE_HOST.test(new URL(raw).hostname);
  } catch {
    return true;
  }
}

/**
 * Política de permissão por chamada de ferramenta. É defesa em profundidade (não substitui isolar o
 * processo em contêiner/usuário dedicado em produção): escrita só no workspace, leitura só em pastas
 * autorizadas, shell sem comandos destrutivos/publicação, rede sem endereços internos.
 */
export function checkToolUse(tool: string, input: Record<string, unknown>, ctx: GuardContext): GuardDecision {
  const ws = realResolve(ctx.workspace);
  const dirs = ctx.readDirs.map(realResolve);
  const resolve = (p: unknown) => realResolve(path.resolve(ctx.workspace, String(p ?? '')));
  const readable = (file: string) => inside(file, ws) || dirs.some((d) => inside(file, d));

  if (tool.startsWith('mcp__md2__')) return { allow: true };
  if (tool.startsWith('mcp__playwright__')) {
    const url = input.url;
    return typeof url === 'string' && isPrivateUrl(url) ? deny('navegação para endereço interno bloqueada') : { allow: true };
  }
  switch (tool) {
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const file = resolve(input.file_path ?? input.notebook_path);
      return inside(file, ws) ? { allow: true } : deny(`escrita fora do workspace bloqueada: ${file}`);
    }
    case 'Read': {
      const file = resolve(input.file_path);
      return readable(file) ? { allow: true } : deny(`leitura fora das pastas autorizadas: ${file}`);
    }
    case 'Glob':
    case 'Grep': {
      const dir = resolve(input.path ?? '.');
      return readable(dir) ? { allow: true } : deny(`busca fora das pastas autorizadas: ${dir}`);
    }
    case 'Bash': {
      const cmd = String(input.command ?? '');
      for (const [re, why] of BASH_DENY) if (re.test(cmd)) return deny(`comando bloqueado (${why})`);
      return { allow: true };
    }
    case 'WebFetch':
      return isPrivateUrl(String(input.url ?? '')) ? deny('acesso a endereço interno bloqueado') : { allow: true };
    case 'SandboxNetworkAccess': {
      // Pedido de rede vindo de um comando dentro do sandbox de SO. Hosts internos nunca.
      const host = String(input.host ?? '');
      return !host || isPrivateUrl(`http://${host}`) ? deny(`rede interna bloqueada: ${host}`) : { allow: true };
    }
    case 'WebSearch':
    case 'TodoWrite':
      return { allow: true };
    default:
      return deny(`ferramenta não autorizada para este agente: ${tool}`);
  }
}

const SECRET_ENV = /^(MD2_|GITHUB_TOKEN|GH_TOKEN|GOOGLE_OAUTH|INSTAGRAM_|IMAGE_GENERATION|AWS_|NPM_TOKEN)/;
/** Ambiente do subprocesso do agente sem os segredos de integração da plataforma. */
export function agentEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_ENV.test(k)));
}
