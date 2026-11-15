import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { ClaudeAgentRuntime } from './runtime/claudeRuntime.js';

process.removeAllListeners('warning');
process.on('warning', (w) => { if (!/SQLite is an experimental/.test(w.message)) console.warn(w); });

const config = loadConfig();
const { services, engine } = bootstrap(config, new ClaudeAgentRuntime());
const server = createApp(services, engine);

server.listen(config.port, config.host, () => {
  const s = services;
  console.log(`MD2 IA Office em http://${config.host}:${config.port}`);
  console.log(`  agentes: ${s.agents.list().length} | skills: ${s.skills.skills.length} | conhecimento: ${s.knowledge.docs.length} docs | ferramentas disponíveis: ${s.tools.tools.filter((t) => t.status === 'disponivel').length}/${s.tools.tools.length}`);
  console.log(`  acesso: ${config.adminPassword ? 'protegido por senha' : 'local sem senha (somente 127.0.0.1)'}`);
  if (s.skills.problems.length) console.warn('  skills com problemas:', s.skills.problems);
  const resumed = engine.recover();
  if (resumed) console.log(`  ${resumed} execução(ões) retomada(s) após reinício`);
});

const shutdown = () => {
  console.log('Encerrando: tarefas em andamento serão retomadas no próximo início.');
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
