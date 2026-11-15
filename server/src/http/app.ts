import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { newId, now } from '../db.js';
import type { Engine, Services } from '../orchestrator/engine.js';
import { Auth } from './auth.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};
/** Extensões aceitas em upload. Executáveis e scripts são recusados. */
const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.zip']);
const MAX_UPLOAD = 500 * 1024 * 1024;
const MAX_JSON = 1024 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const json = (res: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Content-Type deve ser application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_JSON) throw new HttpError(413, 'Corpo da requisição muito grande.');
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}
const safeJoin = (base: string, rel: string) => {
  const p = path.resolve(base, rel);
  const r = path.relative(base, p);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new HttpError(403, 'Caminho inválido.');
  return p;
};

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, headers: Record<string, string> = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'Arquivo não encontrado.');
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...headers };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': size });
  fs.createReadStream(file).pipe(res);
}

export function createApp(s: Services, engine: Engine) {
  const { db, config } = s;
  const auth = new Auth(config);
  const sse = new Set<ServerResponse>();
  s.bus.subscribe((e) => {
    const frame = `id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`;
    for (const r of sse) r.write(frame);
  });
  const heartbeat = setInterval(() => { for (const r of sse) r.write(': ping\n\n'); }, 25_000);
  heartbeat.unref();

  const agentState = () => {
    const busy = db.all<{ agent_id: string; title: string; execution_id: string }>(`SELECT agent_id, title, execution_id FROM tasks WHERE status = 'executando'`);
    const done = db.all<{ agent_id: string; n: number }>(`SELECT agent_id, COUNT(*) AS n FROM tasks WHERE status = 'concluida' GROUP BY agent_id`);
    return s.agents.list().map((a) => ({
      ...a, departmentName: s.agents.department(a.department).name,
      knowledge: s.agents.department(a.department).knowledge,
      tools: a.tools.map((id) => { const t = s.tools.get(id); return { id, name: t?.name ?? id, status: t?.status ?? 'indisponivel' }; }),
      currentTask: busy.find((b) => b.agent_id === a.id) ?? null,
      completedTasks: done.find((d) => d.agent_id === a.id)?.n ?? 0,
    }));
  };
  const executionDetail = (id: string) => {
    const e = db.get('SELECT * FROM executions WHERE id = :id', { id });
    if (!e) throw new HttpError(404, 'Execução não encontrada.');
    return {
      execution: e,
      tasks: db.all('SELECT * FROM tasks WHERE execution_id = :id ORDER BY rowid', { id }),
      events: db.all('SELECT * FROM events WHERE execution_id = :id ORDER BY id DESC LIMIT 400', { id }).reverse(),
      deliverables: s.deliverables.list({ executionId: id }),
      approvals: db.all('SELECT * FROM approvals WHERE execution_id = :id ORDER BY created_at', { id }),
    };
  };

  type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpExecArray, url: URL) => Promise<unknown> | unknown;
  const routes: Array<[string, RegExp, Handler]> = [
    ['GET', /^\/api\/state$/, async () => ({
      runtime: await s.runtime.status(),
      counts: {
        running: db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM executions WHERE status NOT IN ('concluido','falhou','cancelado','aguardando_aprovacao')`)!.n,
        approvals: db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approvals WHERE status = 'pendente'`)!.n,
        review: db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM deliverables WHERE status = 'para_revisao'`)!.n,
      },
      costToday: db.get<{ c: number }>('SELECT COALESCE(SUM(cost_usd),0) AS c FROM executions WHERE created_at >= :d', { d: now().slice(0, 10) })!.c,
      alfred: s.agents.file.alfred,
    })],
    ['GET', /^\/api\/conversations$/, () => db.all('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 200')],
    ['GET', /^\/api\/conversations\/([\w-]+)$/, (_q, _r, m) => {
      const c = db.get('SELECT * FROM conversations WHERE id = :id', { id: m[1] });
      if (!c) throw new HttpError(404, 'Conversa não encontrada.');
      return {
        conversation: c,
        messages: db.all<{ attachments: string }>('SELECT * FROM messages WHERE conversation_id = :id ORDER BY created_at, rowid', { id: m[1] }).map((x) => ({ ...x, attachments: JSON.parse(x.attachments) })),
        executions: db.all('SELECT * FROM executions WHERE conversation_id = :id ORDER BY created_at', { id: m[1] }),
      };
    }],
    ['POST', /^\/api\/messages$/, async (req) => {
      const b = await readJson(req);
      if (typeof b.text !== 'string') throw new HttpError(400, 'Campo "text" obrigatório.');
      const attachments = Array.isArray(b.attachments) ? b.attachments.filter((a): a is { id: string; name: string } => !!a && typeof a.id === 'string') : [];
      try {
        return engine.submit({ conversationId: typeof b.conversationId === 'string' ? b.conversationId : undefined, text: b.text, attachments, clientRequestId: typeof b.clientRequestId === 'string' ? b.clientRequestId : undefined });
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }],
    ['GET', /^\/api\/executions$/, () => db.all(
      `SELECT e.*, c.title AS conversation_title,
        (SELECT COUNT(*) FROM tasks t WHERE t.execution_id = e.id) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.execution_id = e.id AND t.status = 'concluida') AS task_done
       FROM executions e JOIN conversations c ON c.id = e.conversation_id ORDER BY e.created_at DESC LIMIT 200`)],
    ['GET', /^\/api\/executions\/([\w-]+)$/, (_q, _r, m) => executionDetail(m[1])],
    ['POST', /^\/api\/executions\/([\w-]+)\/cancel$/, (_q, _r, m) => ({ cancelled: engine.cancel(m[1]) })],
    ['GET', /^\/api\/agents$/, () => ({ departments: s.agents.file.departments, agents: agentState() })],
    ['GET', /^\/api\/knowledge$/, (_q, _r, _m, url) => {
      const q = url.searchParams.get('q')?.trim();
      return {
        docs: s.knowledge.docs.map(({ body: _b, ...d }) => d),
        hits: q ? s.knowledge.search(q, { limit: 10 }).map((h) => ({ ...h, text: h.text.slice(0, 500) })) : [],
      };
    }],
    ['GET', /^\/api\/knowledge\/doc$/, (_q, _r, _m, url) => {
      const d = s.knowledge.get(url.searchParams.get('id') ?? '');
      if (!d) throw new HttpError(404, 'Documento não encontrado.');
      return d;
    }],
    ['GET', /^\/api\/skills$/, () => ({ skills: s.skills.skills.map(({ dir: _d, ...k }) => k), problems: s.skills.problems })],
    ['GET', /^\/api\/tools$/, () => s.tools.tools],
    ['GET', /^\/api\/deliverables$/, () => s.deliverables.list()],
    ['POST', /^\/api\/deliverables\/([\w-]+)\/decision$/, async (req, _r, m) => {
      const b = await readJson(req);
      if (b.decision !== 'aprovar' && b.decision !== 'ajustar') throw new HttpError(400, 'decision deve ser "aprovar" ou "ajustar".');
      try { return engine.decideDeliverable(m[1], b.decision, typeof b.note === 'string' ? b.note : undefined); } catch (e) { throw new HttpError(400, (e as Error).message); }
    }],
    ['GET', /^\/api\/approvals$/, () => db.all('SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200')],
    ['POST', /^\/api\/approvals\/([\w-]+)\/decision$/, async (req, _r, m) => {
      const b = await readJson(req);
      if (b.decision !== 'aprovar' && b.decision !== 'rejeitar') throw new HttpError(400, 'decision deve ser "aprovar" ou "rejeitar".');
      try { return engine.decideApproval(m[1], b.decision, typeof b.note === 'string' ? b.note : undefined); } catch (e) { throw new HttpError(400, (e as Error).message); }
    }],
    ['GET', /^\/api\/audit$/, () => db.all('SELECT * FROM audit ORDER BY id DESC LIMIT 300')],
    ['GET', /^\/api\/settings$/, () => ({
      authRequired: auth.required, host: config.host, port: config.port,
      limits: {
        maxParallelTasks: config.maxParallelTasks, maxParallelExecutions: config.maxParallelExecutions, taskTimeoutMin: config.taskTimeoutMs / 60000,
        taskMaxTurns: config.taskMaxTurns, taskMaxAttempts: config.taskMaxAttempts, maxCostPerExecution: config.maxCostPerExecution, maxCostPerDay: config.maxCostPerDay,
      },
      models: { alfred: config.modelAlfred ?? 'padrão da conta', agents: config.modelAgents ?? 'padrão da conta' },
      authorizedDirs: config.authorizedDirs,
    })],
    ['POST', /^\/api\/uploads$/, async (req, _r, _m, url) => {
      const name = path.basename(url.searchParams.get('name') ?? '').replace(/[^\w.\- ()À-ÿ]/g, '_').slice(0, 120);
      const ext = path.extname(name).toLowerCase();
      if (!name || !UPLOAD_EXT.has(ext)) throw new HttpError(415, `Tipo de arquivo não permitido (${ext || 'sem extensão'}).`);
      if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) throw new HttpError(413, 'Arquivo acima de 500 MB.');
      const id = newId();
      const rel = path.join('uploads', id, name);
      const dest = path.join(config.dataDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      let size = 0;
      try {
        await pipeline(req, async function* (src) {
          for await (const c of src) {
            size += (c as Buffer).length;
            if (size > MAX_UPLOAD) throw new HttpError(413, 'Arquivo acima de 500 MB.');
            yield c;
          }
        }, fs.createWriteStream(dest));
      } catch (e) {
        fs.rmSync(path.dirname(dest), { recursive: true, force: true });
        throw e;
      }
      if (!size) { fs.rmSync(path.dirname(dest), { recursive: true, force: true }); throw new HttpError(400, 'Arquivo vazio.'); }
      db.insert('uploads', { id, name, rel_path: rel, size, mime: MIME[ext] ?? 'application/octet-stream', created_at: now() });
      db.audit('usuario', 'upload', { id, name, size });
      return { id, name, size };
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const p = decodeURIComponent(url.pathname);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (p === '/api/health') return json(res, { ok: true });
      if (p === '/api/session' && req.method === 'GET') return json(res, { authenticated: auth.check(req), authRequired: auth.required });
      // Proteção CSRF: toda mutação exige cabeçalho próprio (não enviável por formulário de outro site) + cookie SameSite=Strict.
      if (req.method !== 'GET' && req.headers['x-md2'] !== '1') throw new HttpError(403, 'Requisição recusada.');
      if (p === '/api/login' && req.method === 'POST') {
        const b = await readJson(req);
        const r = auth.login(String(b.password ?? ''), req.socket.remoteAddress ?? '?');
        db.audit('usuario', 'error' in r ? 'login_falhou' : 'login');
        return 'error' in r ? json(res, { error: r.error }, r.status) : json(res, { ok: true }, 200, { 'Set-Cookie': r.cookie });
      }
      if (p === '/api/logout' && req.method === 'POST') return json(res, { ok: true }, 200, { 'Set-Cookie': auth.logoutCookie() });

      if (p.startsWith('/api/') || p.startsWith('/files/')) {
        if (!auth.check(req)) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
      }
      if (p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const last = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0);
        if (last > 0) for (const e of s.bus.since(last)) res.write(`id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`);
        res.write(': conectado\n\n');
        sse.add(res);
        req.on('close', () => sse.delete(res));
        return;
      }
      if (p.startsWith('/files/')) {
        const m = /^\/files\/deliverables\/([\w-]+)\/v(\d+)\/(.+)$/.exec(p);
        if (!m || req.method !== 'GET') throw new HttpError(404, 'Arquivo não encontrado.');
        const v = db.get<{ rel_path: string }>('SELECT rel_path FROM deliverable_versions WHERE deliverable_id = :d AND version = :v', { d: m[1], v: Number(m[2]) });
        if (!v) throw new HttpError(404, 'Versão não encontrada.');
        // Conteúdo gerado por agentes roda isolado: origem opaca, sem acesso a cookies nem à API.
        return sendFile(req, res, safeJoin(path.join(config.dataDir, v.rel_path), m[3]), {
          'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
          ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(path.basename(m[3]))}"` } : {}),
        });
      }
      if (p.startsWith('/api/')) {
        for (const [method, re, handler] of routes) {
          const m = re.exec(p);
          if (m && method === req.method) return json(res, await handler(req, res, m, url));
        }
        throw new HttpError(404, 'Rota não encontrada.');
      }
      // Interface (build do Vite) com fallback de SPA.
      if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.');
      const asset = safeJoin(config.webDir, `.${p}`);
      const file = fs.existsSync(asset) && fs.statSync(asset).isFile() ? asset : path.join(config.webDir, 'index.html');
      if (!fs.existsSync(file)) return json(res, { error: 'Interface não compilada. Rode `npm run build` ou use `npm run dev`.' }, 503);
      return sendFile(req, res, file, { 'Cache-Control': p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return json(res, { error: e.message }, e.status);
      console.error('[http]', e);
      return json(res, { error: 'Erro interno.' }, 500);
    }
  });
  server.on('close', () => { clearInterval(heartbeat); for (const r of sse) r.end(); });
  return server;
}
