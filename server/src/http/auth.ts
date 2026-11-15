import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type { Config } from '../config.js';

const COOKIE = 'md2_session';
const TTL_MS = 7 * 24 * 3600_000;

/** Acesso de usuário único. Sem senha definida o servidor só aceita loopback (ver loadConfig). */
export class Auth {
  private secret: Buffer;
  private attempts = new Map<string, { n: number; until: number }>();
  constructor(private config: Config) {
    const file = path.join(config.dataDir, 'session.key');
    fs.mkdirSync(config.dataDir, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
    this.secret = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  }
  get required() { return !!this.config.adminPassword; }

  private sign(payload: string) { return createHmac('sha256', this.secret).update(payload).digest('hex'); }

  login(password: string, ip: string): { cookie: string } | { error: string; status: number } {
    const a = this.attempts.get(ip);
    if (a && a.until > Date.now() && a.n >= 5) return { error: 'Muitas tentativas. Aguarde alguns minutos.', status: 429 };
    const given = createHmac('sha256', this.secret).update(password).digest();
    const expected = createHmac('sha256', this.secret).update(this.config.adminPassword).digest();
    if (!this.required || !timingSafeEqual(given, expected)) {
      this.attempts.set(ip, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 10 * 60_000 });
      return { error: 'Senha incorreta.', status: 401 };
    }
    this.attempts.delete(ip);
    const exp = String(Date.now() + TTL_MS);
    return { cookie: `${COOKIE}=${exp}.${this.sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}` };
  }
  logoutCookie() { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`; }

  check(req: IncomingMessage): boolean {
    if (!this.required) return true;
    const m = new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([a-f0-9]{64})`).exec(req.headers.cookie ?? '');
    if (!m || Number(m[1]) < Date.now()) return false;
    const a = Buffer.from(m[2], 'hex');
    const b = Buffer.from(this.sign(m[1]), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
