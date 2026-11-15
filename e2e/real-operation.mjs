// Teste de OPERAÇÃO REAL (consome créditos do Claude). Sobe o servidor compilado, envia um pedido pela API
// (sem navegador), derruba o processo com SIGKILL no meio de uma tarefa, reinicia, confirma a retomada
// automática, confere entregáveis e registra uma aprovação em ambiente de teste — nada é publicado.
// Uso: npm run build && node e2e/real-operation.mjs "<pedido>" [--sem-queda] [--dados=./data-noturno]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const pedido = args.find((a) => !a.startsWith('--'));
if (!pedido) { console.error('Informe o pedido.'); process.exit(2); }
const semQueda = args.includes('--sem-queda');
const dataDir = path.resolve(args.find((a) => a.startsWith('--dados='))?.slice(8) ?? './data-noturno');
const port = 4397, base = `http://127.0.0.1:${port}`, senha = 'teste-operacao-noturna';
const env = { ...process.env, MD2_PORT: String(port), MD2_DATA_DIR: dataDir, MD2_BACKUP_DIR: `${dataDir}-backups`, MD2_ADMIN_PASSWORD: senha };
const t0 = Date.now();
const log = (m) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { pedido, checks: [] };
const check = (ok, nome, detalhe = '') => { report.checks.push({ ok, nome, detalhe }); log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ` — ${detalhe}` : ''}`); };

let proc;
function start() {
  proc = spawn(process.execPath, ['dist/server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = fs.createWriteStream(path.join(path.dirname(dataDir), `${path.basename(dataDir)}-server.log`), { flags: 'a' });
  proc.stdout.pipe(out); proc.stderr.pipe(out);
  return proc;
}
async function waitUp() {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/health`)).status < 600) return; } catch {} await sleep(200); }
  throw new Error('servidor não subiu');
}
let cookie = '';
const api = async (p, body) => {
  const r = await fetch(base + p, body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-md2': '1' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
async function login() {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-md2': '1' }, body: JSON.stringify({ password: senha }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
}

try {
  start(); await waitUp(); await login();
  const state = (await api('/api/state')).data;
  check(state.sandbox?.active === true, 'sandbox de SO ativo para os agentes', state.sandbox?.detail);
  check(state.runtime?.ready === true, 'runtime conectado', state.runtime?.detail);

  const reqId = `real-${Date.now()}`;
  const sent = (await api('/api/messages', { text: pedido, clientRequestId: reqId })).data;
  const dup = (await api('/api/messages', { text: pedido, clientRequestId: reqId })).data;
  check(dup.executionId === sent.executionId && dup.duplicate === true, 'reenvio com o mesmo identificador não duplica a execução');
  const id = sent.executionId;
  log(`execução ${id}`);

  if (!semQueda) {
    // Espera uma tarefa estar realmente trabalhando (com atividade registrada) e derruba o servidor.
    for (;;) {
      const d = (await api(`/api/executions/${id}`)).data;
      const running = d.tasks?.filter((t) => t.status === 'executando') ?? [];
      const acts = d.events?.filter((e) => e.type === 'atividade' && running.some((t) => t.id === e.task_id)).length ?? 0;
      if (running.length && acts >= 2) { log(`derrubando o servidor com SIGKILL durante: ${running.map((t) => t.title).join(' | ')}`); break; }
      if (['concluido', 'falhou', 'cancelado', 'aguardando_aprovacao'].includes(d.execution?.status)) throw new Error('a execução terminou antes de haver tarefa para interromper');
      await sleep(2000);
    }
    proc.kill('SIGKILL');
    await new Promise((r) => proc.once('exit', r));
    let down = false;
    try { await fetch(`${base}/api/health`); } catch { down = true; }
    check(down, 'servidor fora do ar após SIGKILL (simula queda/fechamento)');
    await sleep(3000);
    start(); await waitUp(); await login();
    log('servidor reiniciado');
  }

  let d;
  for (;;) {
    d = (await api(`/api/executions/${id}`)).data;
    if (['concluido', 'falhou', 'cancelado', 'aguardando_aprovacao'].includes(d.execution.status)) break;
    if (Date.now() - t0 > 45 * 60_000) throw new Error('tempo máximo do teste excedido');
    await sleep(5000);
  }
  const e = d.execution;
  log(`fim: ${e.status} · US$ ${e.cost_usd.toFixed(3)}`);
  report.execucao = { status: e.status, custo_usd: Number(e.cost_usd.toFixed(3)), recuperacoes: e.recoveries, tarefas: d.tasks.map((t) => ({ agente: t.agent_id, titulo: t.title, status: t.status, tentativas: t.attempt, interrupcoes: t.interruptions, custo_usd: Number(t.cost_usd.toFixed(3)), etapas: t.turns })) };
  check(['concluido', 'aguardando_aprovacao'].includes(e.status), 'execução concluída', e.status);
  const agentes = new Set(d.tasks.map((t) => t.agent_id));
  check(agentes.size >= 2, 'Alfred delegou a mais de um agente', [...agentes].join(', '));
  if (!semQueda) {
    check(e.recoveries === 1, 'execução retomada automaticamente após o reinício', `recuperações=${e.recoveries}`);
    check(d.tasks.some((t) => t.interruptions >= 1 && t.status === 'concluida'), 'tarefa interrompida foi concluída depois');
    check(d.events.some((x) => /retomada após reinício/.test(x.message)), 'retomada registrada nos eventos');
  }
  // Paralelismo: duas tarefas com intervalos de execução sobrepostos.
  const starts = d.events.filter((x) => x.type === 'tarefa' && /iniciou/.test(x.message)).map((x) => ({ t: x.task_id, at: Date.parse(x.created_at) }));
  const ends = Object.fromEntries(d.events.filter((x) => x.type === 'tarefa' && /concluiu/.test(x.message)).map((x) => [x.task_id, Date.parse(x.created_at)]));
  const overlap = starts.some((a, i) => starts.some((b, j) => i !== j && a.at < b.at && (ends[a.t] ?? Infinity) > b.at));
  check(overlap, 'houve tarefas executando em paralelo');
  check(d.deliverables.length > 0, 'entregável real registrado', d.deliverables.map((x) => `${x.name} v${x.versions[0].version}`).join('; '));
  for (const dv of d.deliverables) {
    const r = await fetch(base + dv.versions[0].url, { headers: { cookie } });
    check(r.status === 200 && (await r.arrayBuffer()).byteLength > 0, `prévia acessível: ${dv.name}`);
  }
  const msgs = (await api(`/api/conversations/${sent.conversationId}`)).data.messages;
  check(msgs.at(-1)?.role === 'assistant' && msgs.at(-1).content.length > 50, 'Alfred apresentou a devolutiva');
  report.devolutiva = msgs.at(-1)?.content;

  const pend = d.approvals.filter((a) => a.status === 'pendente');
  report.aprovacoes = d.approvals.map((a) => ({ tipo: a.type, titulo: a.title, status: a.status }));
  if (pend.length) {
    const r = (await api(`/api/approvals/${pend[0].id}/decision`, { decision: 'aprovar', note: 'Aprovação registrada em ambiente de TESTE.' })).data;
    check(/nada foi publicado|Nenhuma ação/i.test(r.outcome), 'aprovação registrada sem executar ação externa', r.outcome);
    const again = await api(`/api/approvals/${pend[0].id}/decision`, { decision: 'aprovar' });
    check(again.status === 400, 'aprovação não pode ser decidida duas vezes');
  } else {
    check(true, 'nenhuma ação externa solicitada pelos agentes nesta execução');
  }
  const audit = (await api('/api/audit')).data.map((a) => a.action);
  check(audit.includes('mensagem') && (!pend.length || audit.includes('aprovacao_aprovar')), 'trilha de auditoria registrou mensagem e decisões');
  const costs = (await api('/api/costs')).data;
  report.custos = { execucao: e.cost_usd, porAgente: costs.byAgent, alertas: costs.flagged };
} catch (err) {
  check(false, 'erro no roteiro de teste', err.message);
} finally {
  if (proc && proc.exitCode === null) { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800)); }
  report.ok = report.checks.every((c) => c.ok);
  const out = `${dataDir}-relatorio.json`;
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  log(`relatório: ${out} · ${report.checks.filter((c) => c.ok).length}/${report.checks.length} verificações OK`);
  process.exit(report.ok ? 0 : 1);
}
