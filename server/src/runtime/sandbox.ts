import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '../config.js';

export interface SandboxStatus {
  mode: Config['agentSandbox'];
  active: boolean;
  platformSupported: boolean | 'nao_verificado';
  detail: string;
}

/** Procura o executável no PATH (não executa: `socat --version` retorna erro, socat usa `-V`). */
export const inPath = (bin: string, envPath = process.env.PATH ?? '', platform: string = process.platform, pathExt = process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM') => {
  // No Windows o executável é "ffmpeg.exe": tenta cada extensão de PATHEXT.
  const names = platform === 'win32' ? [bin, ...pathExt.split(';').filter(Boolean).map((e) => bin + e.toLowerCase()), ...pathExt.split(';').filter(Boolean).map((e) => bin + e)] : [bin];
  return envPath.split(path.delimiter).filter(Boolean).some((dir) => names.some((n) => {
    try { fs.accessSync(path.join(dir, n), fs.constants.X_OK); return true; } catch { return false; }
  }));
};

/**
 * Detecta se o sandbox de sistema operacional do Claude Agent SDK pode rodar aqui.
 * Linux exige bubblewrap (bwrap) e socat; macOS usa o sandbox nativo do sistema.
 * Validado neste projeto apenas em Linux (ver docs/SEGURANCA.md).
 */
export function detectSandbox(config: Config, probe: (bin: string) => boolean = inPath, platform = process.platform): SandboxStatus {
  if (config.agentSandbox === 'off') {
    return { mode: 'off', active: false, platformSupported: false, detail: 'Desativado por MD2_AGENT_SANDBOX=off. Comandos dos agentes rodam com as permissões do servidor.' };
  }
  let supported: boolean | 'nao_verificado';
  let why: string;
  if (platform === 'linux') {
    const bwrap = probe('bwrap'), socat = probe('socat');
    supported = bwrap && socat;
    why = supported ? 'bubblewrap e socat encontrados.' : `Faltam: ${[!bwrap && 'bubblewrap (bwrap)', !socat && 'socat'].filter(Boolean).join(', ')}. Instale com: sudo apt-get install -y bubblewrap socat`;
  } else if (platform === 'darwin') {
    supported = 'nao_verificado';
    why = 'macOS usa o sandbox nativo; não foi testado nesta versão do MD2.';
  } else {
    supported = 'nao_verificado';
    why = `Plataforma ${platform}: suporte ao sandbox não verificado nesta versão do MD2.`;
  }
  if (supported === true) return { mode: config.agentSandbox, active: true, platformSupported: true, detail: `Sandbox de SO ativo para comandos dos agentes. ${why}` };
  if (config.agentSandbox === 'required') {
    // Em modo obrigatório, entregamos a decisão ao SDK com failIfUnavailable: se não suportar, a tarefa falha.
    return { mode: 'required', active: supported === 'nao_verificado', platformSupported: supported, detail: supported === 'nao_verificado' ? `Sandbox exigido; o SDK recusará executar se não conseguir isolar. ${why}` : `Sandbox exigido, mas indisponível: ${why}` };
  }
  return { mode: 'auto', active: false, platformSupported: supported, detail: `Sandbox inativo: ${why} Os agentes rodam apenas com o guard de permissões (não é isolamento).` };
}

/** Variáveis que nunca podem ser lidas por comandos dos agentes, mesmo que o processo do runtime precise delas. */
export const DENIED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS'];

/** Configuração de sandbox por tarefa: escrita só no workspace; leitura do diretório de dados negada exceto o próprio workspace. */
export function buildSandbox(opts: { workspace: string; dataDir: string; rootDir: string; readDirs: string[]; required: boolean }) {
  const home = os.homedir();
  return {
    enabled: true,
    failIfUnavailable: opts.required,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: {
      allowWrite: [opts.workspace],
      denyRead: [opts.dataDir, path.join(opts.rootDir, '.env'), path.join(home, '.claude'), path.join(home, '.ssh'), path.join(home, '.aws'), path.join(home, '.config'), path.join(home, '.gnupg'), path.join(home, '.netrc'), path.join(home, '.npmrc')],
      allowRead: [opts.workspace, ...opts.readDirs],
    },
    credentials: { envVars: DENIED_ENV.map((name) => ({ name, mode: 'deny' as const })) },
  };
}
