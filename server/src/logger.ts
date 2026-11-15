import fs from 'node:fs';
import path from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/** Padrões de segredo mascarados em qualquer log, mesmo que cheguem por engano em uma mensagem. */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bEAA[A-Za-z0-9]{30,}\b/g,
  /\bya29\.[A-Za-z0-9_-]{20,}\b/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /("?(password|senha|token|secret|api[_-]?key|authorization|cookie)"?\s*[:=]\s*)("[^"]*"|[^\s,}]+)/gi,
];
export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (_m, p1) => (typeof p1 === 'string' && /[:=]\s*$/.test(p1) ? `${p1}"[redigido]"` : '[redigido]'));
  return out;
}

/** Logs estruturados (JSON por linha) no stdout e em arquivo diário, com mascaramento de segredos e retenção. */
export class Logger {
  private dir?: string;
  private retentionDays = 30;
  constructor(private name = 'md2') {}

  configure(dir: string, retentionDays = 30) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    this.retentionDays = retentionDays;
    this.prune();
  }

  log(level: Level, msg: string, data?: Record<string, unknown>) {
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, src: this.name, msg, ...(data ?? {}) }));
    (level === 'error' || level === 'critical' ? process.stderr : process.stdout).write(line + '\n');
    if (this.dir) {
      try { fs.appendFileSync(path.join(this.dir, `md2-${new Date().toISOString().slice(0, 10)}.jsonl`), line + '\n'); } catch { /* disco cheio não pode derrubar o servidor */ }
    }
  }
  info(msg: string, data?: Record<string, unknown>) { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.log('error', msg, data); }
  critical(msg: string, data?: Record<string, unknown>) { this.log('critical', msg, data); }

  /** Remove apenas arquivos de log deste logger mais antigos que a retenção. */
  private prune() {
    if (!this.dir) return;
    const limit = Date.now() - this.retentionDays * 86_400_000;
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^md2-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (m && Date.parse(m[1]) < limit) fs.rmSync(path.join(this.dir, f), { force: true });
    }
  }
}

export const log = new Logger();
export const errorInfo = (e: unknown) => (e instanceof Error ? { error: e.message, stack: e.stack?.split('\n').slice(0, 4).join(' | ') } : { error: String(e) });
