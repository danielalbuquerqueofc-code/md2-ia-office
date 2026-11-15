/**
 * Teste real de ponta a ponta do runtime (consome créditos da conta Claude configurada).
 * Uso: npm run smoke:runtime -- "pedido para o Alfred" [arquivo-para-anexar ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { newId, now } from '../src/db.js';
import { ClaudeAgentRuntime } from '../src/runtime/claudeRuntime.js';

const [text, ...files] = process.argv.slice(2);
if (!text) throw new Error('Informe o pedido.');
const config = loadConfig({ MD2_DATA_DIR: './data-smoke', MD2_MAX_COST_USD_PER_EXECUTION: '6', ...process.env });
const { services, engine } = bootstrap(config, new ClaudeAgentRuntime());
const t0 = Date.now();
services.bus.subscribe((e) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${e.type.padEnd(10)} ${e.agent_id ? `<${e.agent_id}> ` : ''}${e.message.replace(/\s+/g, ' ').slice(0, 220)}`));

const attachments = files.map((f) => {
  const id = newId();
  const rel = path.join('uploads', id, path.basename(f));
  fs.mkdirSync(path.join(config.dataDir, 'uploads', id), { recursive: true });
  fs.copyFileSync(f, path.join(config.dataDir, rel));
  services.db.insert('uploads', { id, name: path.basename(f), rel_path: rel, size: fs.statSync(f).size, mime: 'application/octet-stream', created_at: now() });
  return { id, name: path.basename(f) };
});
const { executionId, conversationId } = engine.submit({ text, attachments });
await engine.whenIdle();
const e = services.db.get<{ status: string; cost_usd: number; error: string | null }>('SELECT * FROM executions WHERE id = :id', { id: executionId })!;
console.log('\n=== RESULTADO ===');
console.log({ status: e.status, custoUSD: Number(e.cost_usd.toFixed(3)), erro: e.error, segundos: Math.round((Date.now() - t0) / 1000) });
console.log('tarefas:', services.db.all('SELECT key, agent_id, status, attempt FROM tasks WHERE execution_id = :id', { id: executionId }));
console.log('entregáveis:', services.deliverables.list({ executionId }).map((d) => ({ nome: d.name, categoria: d.category, versoes: d.versions.map((v) => `${v.kind} ${v.size}b ${path.join(config.dataDir, 'deliverables', d.id, 'v' + v.version, v.entry)}`) })));
console.log('aprovações:', services.db.all('SELECT type, title, status FROM approvals WHERE execution_id = :id', { id: executionId }));
console.log('\n--- resposta do Alfred ---\n' + services.db.get<{ content: string }>(`SELECT content FROM messages WHERE conversation_id = :c AND role = 'assistant' ORDER BY rowid DESC`, { c: conversationId })?.content);
services.db.close();
