/**
 * Verificação REAL do isolamento (consome uma chamada pequena ao modelo). Usa o mesmo caminho de código das
 * tarefas: pede a um agente que tente violar o sandbox e confere o resultado no disco.
 * Uso: npm run sandbox:check
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { ClaudeAgentRuntime } from '../src/runtime/claudeRuntime.js';

// Fora de /tmp de propósito: /tmp é gravável dentro do sandbox e mascararia o teste de escrita.
const root = fs.mkdtempSync(path.join(os.homedir(), '.md2-sandbox-check-'));
const dataDir = path.join(root, 'data');
const ws = path.join(dataDir, 'workspaces', 'A');
fs.mkdirSync(ws, { recursive: true });
fs.mkdirSync(path.join(dataDir, 'workspaces', 'B'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'workspaces', 'B', 'contrato.txt'), 'segredo do cliente B');
fs.writeFileSync(path.join(dataDir, 'md2.sqlite'), 'banco');
const outside = path.join(root, 'fora.txt');

const config = loadConfig({ ...process.env, MD2_DATA_DIR: dataDir }, process.cwd());
const runtime = new ClaudeAgentRuntime(config);
console.log('sandbox:', runtime.sandbox());

const cmd = [
  'echo dentro > ok.txt && echo W_DENTRO=ok',
  `(echo x > ${outside} && echo W_FORA=ESCREVEU) 2>&1 | tail -1`,
  `(cat ${dataDir}/workspaces/B/contrato.txt && echo R_VIZINHO=LEU) 2>&1 | tail -1`,
  `(cat ${dataDir}/md2.sqlite && echo R_BANCO=LEU) 2>&1 | tail -1`,
  'echo "TMP=$TMPDIR"; echo t > "$TMPDIR/t.txt" && echo W_TMP=ok',
  `python3 -c "import socket,os; s=socket.socket(socket.AF_UNIX); s.bind(os.environ['TMPDIR']+'/s.sock'); print('SOCKET=ok')" 2>&1 | tail -1`,
].join('; ');
const blocked: string[] = [];
const res = await runtime.runAgent({
  system: 'Você executa exatamente o comando pedido, uma única vez, e devolve a saída literal.',
  prompt: `Execute com a ferramenta Bash, uma única vez e sem modificar, e responda só com a saída:\n${cmd}`,
  cwd: ws, dataDir, sdkTools: ['Bash'], readDirs: [], usePlaywright: false, maxTurns: 4, maxBudgetUsd: 0.5,
  handlers: { registrarEntregavel: async () => '', solicitarAprovacao: async () => '', consultarConhecimento: async () => '' },
  signal: new AbortController().signal,
  onActivity: (a) => { if (a.kind === 'bloqueio') blocked.push(`${a.message} :: ${a.detail}`); },
});
console.log(res.text);
const checks: Array<[string, boolean]> = [
  ['escreve dentro do workspace', fs.existsSync(path.join(ws, 'ok.txt'))],
  ['NÃO escreve fora do workspace', !fs.existsSync(outside)],
  ['NÃO lê workspace de outro cliente', !/R_VIZINHO=LEU/.test(res.text)],
  ['NÃO lê o banco', !/R_BANCO=LEU/.test(res.text)],
  ['temporário próprio gravável', /W_TMP=ok/.test(res.text)],
];
// Informativo: o sandbox do Linux nega a criação de sockets Unix por padrão (protege, por exemplo, o docker.sock).
console.log(`i sockets Unix dentro do sandbox: ${/SOCKET=ok/.test(res.text) ? 'permitidos' : 'bloqueados (padrão do sandbox)'}`);
for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} ${name}`);
if (blocked.length) console.log('bloqueios do guard:', blocked);
console.log(`custo: US$ ${res.costUsd.toFixed(3)}`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
