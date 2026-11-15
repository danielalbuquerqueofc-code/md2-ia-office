import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { plan, setup } from './helpers.js';

const t = setup({ MD2_ADMIN_PASSWORD: 'senha-forte-123' });
const server = createApp(t.services, t.engine);
let base = '';
let cookie = '';
const H = { 'x-md2': '1', 'content-type': 'application/json' };
const call = (p: string, init: RequestInit = {}) => fetch(base + p, { ...init, headers: { cookie, ...(init.headers ?? {}) } });

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); t.cleanup(); });

describe('API HTTP', () => {
  it('exige autenticação em API e arquivos', async () => {
    expect((await fetch(base + '/api/agents')).status).toBe(401);
    expect((await fetch(base + '/files/deliverables/x/v1/index.html')).status).toBe(401);
    expect((await fetch(base + '/api/stream')).status).toBe(401);
    expect(await (await fetch(base + '/api/session')).json()).toEqual({ authenticated: false, authRequired: true });
    expect((await fetch(base + '/api/health')).status).toBe(200);
  });

  it('recusa senha errada, bloqueia requisição sem cabeçalho anti-CSRF e autentica com a senha correta', async () => {
    expect((await fetch(base + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ password: 'errada' }) })).status).toBe(401);
    expect((await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'senha-forte-123' }) })).status).toBe(403);
    const ok = await fetch(base + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ password: 'senha-forte-123' }) });
    expect(ok.status).toBe(200);
    const set = ok.headers.get('set-cookie')!;
    expect(set).toMatch(/HttpOnly; SameSite=Strict/);
    cookie = set.split(';')[0];
    expect((await call('/api/agents')).status).toBe(200);
    expect((await fetch(base + '/api/agents', { headers: { cookie: cookie.slice(0, -4) + 'aaaa' } })).status).toBe(401);
  });

  it('lista os 22 agentes, ferramentas, skills e conhecimento sem expor segredos', async () => {
    const { agents } = await (await call('/api/agents')).json();
    expect(agents).toHaveLength(22);
    expect(agents[0]).toHaveProperty('currentTask');
    const tools = await (await call('/api/tools')).json();
    expect(tools.find((x: { id: string }) => x.id === 'instagram').status).toBe('pendente');
    expect((await (await call('/api/skills')).json()).skills.length).toBeGreaterThan(10);
    const k = await (await call('/api/knowledge?q=precificação margem')).json();
    expect(k.hits[0].docId).toBe('financeiro/gestao-financeira');
    const settings = JSON.stringify(await (await call('/api/settings')).json());
    expect(settings).not.toContain('senha-forte-123');
  });

  it('valida uploads por tipo e aceita arquivo permitido', async () => {
    expect((await call('/api/uploads?name=virus.exe', { method: 'POST', headers: { 'x-md2': '1' }, body: 'x' })).status).toBe(415);
    expect((await call('/api/uploads?name=script.sh', { method: 'POST', headers: { 'x-md2': '1' }, body: 'x' })).status).toBe(415);
    const up = await call('/api/uploads?name=../../logo.png', { method: 'POST', headers: { 'x-md2': '1' }, body: Buffer.from('png-bytes') });
    expect(up.status).toBe(200);
    const { id, name } = await up.json();
    expect(name).toBe('logo.png');
    expect(fs.existsSync(path.join(t.dataDir, 'uploads', id, 'logo.png'))).toBe(true);
  });

  it('fluxo completo: mensagem → eventos em tempo real (SSE) → entregável servido isolado → aprovação', async () => {
    t.runtime.plans.push(plan([{ chave: 'site', agente: 'bruno' }]));
    t.runtime.agentImpl = async (o) => {
      expect(fs.readdirSync(path.join(o.cwd, 'entrada'))).toEqual(['logo.png']);
      fs.mkdirSync(path.join(o.cwd, 'entregas/site'), { recursive: true });
      fs.writeFileSync(path.join(o.cwd, 'entregas/site/index.html'), '<!doctype html><h1>Padaria</h1>');
      await o.handlers.registrarEntregavel({ caminho: 'entregas/site', nome: 'Site — Padaria', categoria: 'site', cliente: 'Padaria' });
      return { text: 'site pronto', costUsd: 0.01 };
    };
    const up = await (await call('/api/uploads?name=logo.png', { method: 'POST', headers: { 'x-md2': '1' }, body: Buffer.from('png') })).json();

    const stream = await call('/api/stream');
    const reader = stream.body!.getReader();
    const seen: string[] = [];
    const pump = (async () => {
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const line of dec.decode(value).split('\n')) if (line.startsWith('data: ')) seen.push(JSON.parse(line.slice(6)).message);
        if (seen.includes('Execução concluída.')) return;
      }
    })();

    const sent = await (await call('/api/messages', { method: 'POST', headers: H, body: JSON.stringify({ text: 'Crie o site da padaria', attachments: [up], clientRequestId: 'c-1' }) })).json();
    await pump;
    await reader.cancel();
    expect(seen).toContain('Alfred recebeu a solicitação.');
    expect(seen).toContain('Bruno iniciou: Tarefa site');
    expect(seen).toContain('Bruno registrou o entregável "Site — Padaria" (v1).');

    const detail = await (await call(`/api/executions/${sent.executionId}`)).json();
    expect(detail.execution.status).toBe('concluido');
    expect(detail.tasks[0].status).toBe('concluida');
    const conv = await (await call(`/api/conversations/${sent.conversationId}`)).json();
    expect(conv.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);

    const [d] = await (await call('/api/deliverables')).json();
    const page = await call(d.versions[0].url);
    expect(await page.text()).toContain('Padaria');
    expect(page.headers.get('content-security-policy')).toMatch(/^sandbox/);
    expect((await call(`/files/deliverables/${d.id}/v1/..%2f..%2f..%2fmd2.sqlite`)).status).toBe(403);
    expect((await call(`/files/deliverables/${d.id}/v9/index.html`)).status).toBe(404);

    expect((await call(`/api/deliverables/${d.id}/decision`, { method: 'POST', headers: H, body: JSON.stringify({ decision: 'publicar' }) })).status).toBe(400);
    expect((await call(`/api/deliverables/${d.id}/decision`, { method: 'POST', headers: H, body: JSON.stringify({ decision: 'aprovar' }) })).status).toBe(200);
    expect((await (await call('/api/deliverables')).json())[0].status).toBe('aprovado');
    const audit = await (await call('/api/audit')).json();
    expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['login', 'login_falhou', 'upload', 'mensagem', 'entregavel_aprovar']));
  });

  it('rejeita entradas inválidas', async () => {
    expect((await call('/api/messages', { method: 'POST', headers: H, body: '{' })).status).toBe(400);
    expect((await call('/api/messages', { method: 'POST', headers: H, body: JSON.stringify({ text: '   ' }) })).status).toBe(400);
    expect((await call('/api/executions/nao-existe')).status).toBe(404);
    expect((await call('/api/nada')).status).toBe(404);
  });
});
