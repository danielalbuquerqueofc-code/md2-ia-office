import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createApp } from './http/app.js';
import { errorInfo, log } from './logger.js';
import { startMonitor } from './monitor.js';
import { ClaudeAgentRuntime } from './runtime/claudeRuntime.js';

process.removeAllListeners('warning');
process.on('warning', (w) => { if (!/SQLite is an experimental/.test(w.message)) log.warn('node_warning', { message: w.message }); });

const config = loadConfig();
log.configure(config.logDir);
const runtime = new ClaudeAgentRuntime(config);
const { services, engine } = bootstrap(config, runtime);
const server = createApp(services, engine);

// Falha inesperada: registra como crítica e encerra para o supervisor (systemd/pm2/Docker) reiniciar.
// No reinício, Engine.recover() retoma as execuções com limite de tentativas.
process.on('uncaughtException', (e) => {
  log.critical('excecao_nao_tratada', errorInfo(e));
  try { services.db.audit('sistema', 'falha_critica', { excecao: (e as Error).message }); } catch { /* banco indisponível */ }
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  log.critical('promessa_rejeitada_nao_tratada', errorInfo(e));
  try { services.db.audit('sistema', 'falha_critica', { rejeicao: e instanceof Error ? e.message : String(e) }); } catch { /* idem */ }
});

server.listen(config.port, config.host, () => {
  const s = services;
  const sandbox = runtime.sandbox();
  log.info('servidor_iniciado', {
    url: `http://${config.host}:${config.port}`,
    agentes: s.agents.list().length, skills: s.skills.skills.length, conhecimento: s.knowledge.docs.length,
    ferramentasDisponiveis: s.tools.tools.filter((t) => t.status === 'disponivel').length,
    acesso: config.adminPassword ? 'senha' : 'somente_local',
    isolamento: sandbox.active ? 'sandbox_ativo' : 'sem_sandbox', isolamentoDetalhe: sandbox.detail,
    backups: config.backupDir, logs: config.logDir,
  });
  if (!sandbox.active) log.warn('isolamento_inativo', { detalhe: sandbox.detail });
  if (s.skills.problems.length) log.warn('skills_com_problemas', { problemas: s.skills.problems });
  const resumed = engine.recover();
  if (resumed) log.info('execucoes_retomadas', { quantidade: resumed });
  startMonitor(config, s.db, s.backups, () => ({ ready: runtime.peek()?.ready ?? null, sandbox: runtime.sandbox() }));
});

const shutdown = (signal: string) => {
  log.info('encerrando', { signal, nota: 'tarefas em andamento serão retomadas no próximo início' });
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
