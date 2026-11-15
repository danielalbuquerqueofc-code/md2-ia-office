import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { redact } from '../src/logger.js';
import { checkToolUse, realResolve } from '../src/runtime/guard.js';
import { buildSandbox, DENIED_ENV, detectSandbox } from '../src/runtime/sandbox.js';
import { ROOT } from './helpers.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-sec-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('links simbólicos não escapam do workspace', () => {
  const ws = path.join(tmp, 'ws');
  const secret = path.join(tmp, 'segredo');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(secret, { recursive: true });
  fs.writeFileSync(path.join(secret, 'chave.txt'), 'x');
  fs.symlinkSync(secret, path.join(ws, 'atalho'));
  const ctx = { workspace: ws, readDirs: [] };

  it('resolve o caminho real mesmo para arquivo que ainda não existe', () => {
    expect(realResolve(path.join(ws, 'atalho', 'novo.txt'))).toBe(path.join(fs.realpathSync(secret), 'novo.txt'));
  });
  it('bloqueia Read, Write e Grep através do link', () => {
    expect(checkToolUse('Read', { file_path: 'atalho/chave.txt' }, ctx).allow).toBe(false);
    expect(checkToolUse('Write', { file_path: 'atalho/novo.txt' }, ctx).allow).toBe(false);
    expect(checkToolUse('Grep', { pattern: 'x', path: 'atalho' }, ctx).allow).toBe(false);
    expect(checkToolUse('Write', { file_path: 'entregas/ok.txt' }, ctx).allow).toBe(true);
  });
});

describe('guard: rede do sandbox e credenciais', () => {
  const ctx = { workspace: tmp, readDirs: [] };
  it('libera hosts públicos e bloqueia internos pedidos pelo sandbox', () => {
    expect(checkToolUse('SandboxNetworkAccess', { host: 'registry.npmjs.org' }, ctx).allow).toBe(true);
    expect(checkToolUse('SandboxNetworkAccess', { host: '127.0.0.1' }, ctx).allow).toBe(false);
    expect(checkToolUse('SandboxNetworkAccess', { host: '169.254.169.254' }, ctx).allow).toBe(false);
    expect(checkToolUse('SandboxNetworkAccess', { host: '' }, ctx).allow).toBe(false);
  });
  it('bloqueia leitura de variáveis de credencial pelo shell', () => {
    for (const command of ['echo $ANTHROPIC_API_KEY', 'echo "$GITHUB_TOKEN"', 'cat /proc/self/environ', 'set | grep KEY', 'export -p', 'declare -x'])
      expect(checkToolUse('Bash', { command }, ctx).allow, command).toBe(false);
    expect(checkToolUse('Bash', { command: 'ffmpeg -i a.mp4 -c copy b.mp4' }, ctx).allow).toBe(true);
  });
});

describe('sandbox de sistema operacional', () => {
  const base = loadConfig({}, ROOT);
  it('fica ativo no Linux somente com bubblewrap e socat', () => {
    expect(detectSandbox(base, () => true, 'linux').active).toBe(true);
    const missing = detectSandbox(base, (b) => b !== 'bwrap', 'linux');
    expect(missing.active).toBe(false);
    expect(missing.detail).toMatch(/bubblewrap/);
  });
  it('respeita off e required', () => {
    expect(detectSandbox(loadConfig({ MD2_AGENT_SANDBOX: 'off' }, ROOT), () => true, 'linux').active).toBe(false);
    const req = detectSandbox(loadConfig({ MD2_AGENT_SANDBOX: 'required' }, ROOT), () => false, 'linux');
    expect(req).toMatchObject({ active: false, mode: 'required' });
    expect(() => loadConfig({ MD2_AGENT_SANDBOX: 'talvez' }, ROOT)).toThrow(/auto, required ou off/);
  });
  it('restringe escrita ao workspace, nega leitura dos dados exceto o próprio workspace e bloqueia credenciais', () => {
    const sb = buildSandbox({ workspace: '/d/workspaces/c1', dataDir: '/d', rootDir: '/app', readDirs: ['/clientes'], required: true });
    expect(sb.filesystem.allowWrite).toEqual(['/d/workspaces/c1']);
    expect(sb.filesystem.denyRead).toContain('/d');
    expect(sb.filesystem.denyRead).toContain('/app/.env');
    expect(sb.filesystem.allowRead).toEqual(['/d/workspaces/c1', '/clientes']);
    expect(sb.allowUnsandboxedCommands).toBe(false);
    expect(sb.failIfUnavailable).toBe(true);
    expect(sb.credentials.envVars.map((v) => v.name)).toEqual(DENIED_ENV);
    expect(sb.credentials.envVars.every((v) => v.mode === 'deny')).toBe(true);
  });
});

describe('logs não vazam segredos', () => {
  it('mascara chaves, tokens e campos sensíveis', () => {
    const out = redact(JSON.stringify({ msg: 'falha com sk-ant-api03-AbCdEfGhIjKlMnOp e ghp_0123456789abcdefghijABCDEFGHIJ', password: 'minha-senha', authorization: 'Bearer abcdefghijklmnop' }));
    expect(out).not.toMatch(/sk-ant-api03|ghp_0123|minha-senha|abcdefghijklmnop/);
    expect(out).toContain('[redigido]');
  });
});
