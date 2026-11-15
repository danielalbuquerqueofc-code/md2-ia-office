import fs from 'node:fs';
import type { BackupService } from './backup.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorInfo, log } from './logger.js';

export interface HealthReport {
  ok: boolean;
  status: 'saudavel' | 'atencao' | 'critico';
  uptimeSec: number;
  checks: Record<string, { ok: boolean; detail: string }>;
  queue: { running: number; stuckTasks: number };
  backup: { last: string | null; ageHours: number | null; verified: boolean | null };
  memoryMb: number;
}

const MIN_FREE_BYTES = 2 * 1024 ** 3;
const started = Date.now();

/** Verificações de saúde baratas (nenhuma chamada paga ao modelo). */
export function healthReport(config: Config, db: Db, backups: BackupService, runtime: { ready: boolean | null; sandbox: { active: boolean; detail: string } }): HealthReport {
  const checks: HealthReport['checks'] = {};
  try {
    const r = db.get<{ quick_check: string }>('PRAGMA quick_check');
    checks.banco = { ok: r?.quick_check === 'ok', detail: r?.quick_check ?? 'sem resposta' };
  } catch (e) {
    checks.banco = { ok: false, detail: (e as Error).message };
  }
  try {
    const st = fs.statfsSync(config.dataDir);
    const free = st.bavail * st.bsize;
    checks.disco = { ok: free > MIN_FREE_BYTES, detail: `${(free / 1024 ** 3).toFixed(1)} GB livres em ${config.dataDir}` };
  } catch (e) {
    checks.disco = { ok: false, detail: (e as Error).message };
  }
  const stuckBefore = new Date(Date.now() - config.taskTimeoutMs * 1.5).toISOString();
  const stuck = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'executando' AND started_at < :t`, { t: stuckBefore })!.n;
  checks.tarefas = { ok: stuck === 0, detail: stuck ? `${stuck} tarefa(s) executando além de 1,5× o tempo limite` : 'nenhuma tarefa travada' };
  checks.runtime = { ok: runtime.ready !== false, detail: runtime.ready === null ? 'ainda não verificado' : runtime.ready ? 'conectado' : 'indisponível' };
  checks.isolamento = { ok: runtime.sandbox.active, detail: runtime.sandbox.detail };
  const last = backups.latest();
  const ageHours = last ? (Date.now() - Date.parse(last.manifest.createdAt)) / 3_600_000 : null;
  checks.backup = {
    ok: !!last && last.manifest.verified && ageHours! < config.backupIntervalHours * 2 + 1,
    detail: last ? `último em ${last.manifest.createdAt} (${ageHours!.toFixed(1)} h), ${last.manifest.verified ? 'verificado' : 'NÃO verificado'}` : 'nenhum backup ainda',
  };
  const running = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM executions WHERE status NOT IN ('concluido','falhou','cancelado','aguardando_aprovacao')`)!.n;
  const critical = !checks.banco.ok || !checks.disco.ok;
  const warn = Object.values(checks).some((c) => !c.ok);
  return {
    ok: !critical,
    status: critical ? 'critico' : warn ? 'atencao' : 'saudavel',
    uptimeSec: Math.round((Date.now() - started) / 1000),
    checks,
    queue: { running, stuckTasks: stuck },
    backup: { last: last?.manifest.createdAt ?? null, ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)), verified: last?.manifest.verified ?? null },
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };
}

/**
 * Rotina contínua: backup automático no intervalo configurado e registro de problemas de saúde.
 * Falhas críticas vão para o log (nível critical) e para a trilha de auditoria.
 */
export function startMonitor(config: Config, db: Db, backups: BackupService, runtime: () => { ready: boolean | null; sandbox: { active: boolean; detail: string } }) {
  let lastStatus = '';
  let backingUp = false;
  const tick = async () => {
    const h = healthReport(config, db, backups, runtime());
    const problems = Object.entries(h.checks).filter(([, c]) => !c.ok).map(([k, c]) => `${k}: ${c.detail}`);
    const sig = `${h.status}|${problems.join(';')}`;
    if (sig !== lastStatus) {
      log[h.status === 'critico' ? 'critical' : h.status === 'atencao' ? 'warn' : 'info']('saude', { status: h.status, problemas: problems });
      if (h.status === 'critico') db.audit('sistema', 'falha_critica', { problemas: problems });
      lastStatus = sig;
    }
    const last = backups.latest();
    const due = !last || Date.now() - Date.parse(last.manifest.createdAt) >= config.backupIntervalHours * 3_600_000;
    if (due && !backingUp) {
      backingUp = true;
      try {
        const snap = await backups.create();
        log.info('backup_criado', { snapshot: snap.name, copiados: snap.manifest.files.copied, verificado: snap.manifest.verified });
      } catch (e) {
        log.critical('backup_falhou', errorInfo(e));
        db.audit('sistema', 'falha_critica', { backup: (e as Error).message });
      } finally {
        backingUp = false;
      }
    }
  };
  const timer = setInterval(() => { void tick(); }, 5 * 60_000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
