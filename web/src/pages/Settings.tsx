import { useState } from 'react';
import type { AppState } from '../api';
import { api, useData } from '../api';
import { Badge, dateTime, Loading, usd } from '../ui';

interface SettingsData {
  authRequired: boolean; host: string; port: number; authorizedDirs: string[]; models: { alfred: string; agents: string };
  limits: { maxParallelTasks: number; maxParallelExecutions: number; taskTimeoutMin: number; taskMaxTurns: number; taskMaxAttempts: number; maxCostPerExecution: number; maxCostPerDay: number; maxCostPerTask: number; maxRecoveries: number };
}
interface Health { status: string; uptimeSec: number; checks: Record<string, { ok: boolean; detail: string }>; queue: { running: number; stuckTasks: number }; memoryMb: number }
interface Snapshot { name: string; createdAt: string; verified: boolean; db: { bytes: number; integrity: string }; counts: Record<string, number>; files: { mirrored: number } }
interface Backups { dir: string; intervalHours: number; keep: number; snapshots: Snapshot[] }
interface Costs {
  today: number; total: number; limits: { task: number; execution: number; day: number };
  byAgent: Array<{ agent_id: string; tasks: number; cost_usd: number; avg_cost_usd: number; turns: number; output_tokens: number }>;
  byExecution: Array<{ id: string; title: string; status: string; cost_usd: number; alfred_cost_usd: number; created_at: string }>;
  flagged: Array<{ id: string; agent_id: string; title: string; cost_usd: number; turns: number; attempt: number; motivo: string }>;
}
const CHECK_LABEL: Record<string, string> = { banco: 'Banco de dados', disco: 'Espaço em disco', tarefas: 'Tarefas travadas', runtime: 'Runtime', isolamento: 'Isolamento dos agentes', backup: 'Backup' };

const Row = ({ k, v, env }: { k: string; v: React.ReactNode; env?: string }) => (
  <div className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}><span className="grow">{k}{env && <div className="mono dim">{env}</div>}</span><span className="muted" style={{ textAlign: 'right' }}>{v}</span></div>
);

export function Settings({ state }: { state: AppState | null }) {
  const { data } = useData<SettingsData>('/api/settings', () => false);
  const health = useData<Health>('/api/health/details', () => false);
  const backups = useData<Backups>('/api/backups', () => false);
  const costs = useData<Costs>('/api/costs', (e) => e.type === 'status');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key); setMsg(null);
    try { setMsg({ ok: true, text: await fn() }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(''); }
  };
  if (!data) return <div className="page"><Loading /></div>;
  const l = data.limits;
  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      <div className="page-head"><div><h1>Configurações</h1><p>Valores lidos do arquivo <code>.env</code> no servidor. Credenciais nunca são exibidas nem enviadas ao navegador. Para alterar, edite o <code>.env</code> e reinicie o serviço.</p></div></div>
      {msg && <div className={`banner ${msg.ok ? '' : 'err'}`} style={{ marginBottom: 14 }}>{msg.text}</div>}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
        <div className="card pad">
          <div className="row" style={{ marginBottom: 8 }}><h2 className="grow">Saúde do sistema</h2>{health.data && <Badge status={health.data.status === 'saudavel' ? 'concluido' : health.data.status === 'critico' ? 'falhou' : 'para_revisao'}>{health.data.status === 'saudavel' ? 'Saudável' : health.data.status === 'critico' ? 'Crítico' : 'Atenção'}</Badge>}</div>
          {!health.data ? <Loading rows={2} h={30} /> : Object.entries(health.data.checks).map(([k, c]) => <Row key={k} k={CHECK_LABEL[k] ?? k} v={<span title={c.detail}><Badge status={c.ok ? 'concluido' : 'falhou'}>{c.ok ? 'OK' : 'Problema'}</Badge></span>} />)}
          {health.data && <p className="xs dim" style={{ marginTop: 10 }}>Em execução: {health.data.queue.running} · memória {health.data.memoryMb} MB · ativo há {Math.round(health.data.uptimeSec / 60)} min</p>}
          {health.data && Object.entries(health.data.checks).filter(([, c]) => !c.ok).map(([k, c]) => <p key={k} className="small" style={{ marginTop: 6, color: 'var(--warning)' }}>{CHECK_LABEL[k] ?? k}: {c.detail}</p>)}
        </div>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Runtime e isolamento</h2>
          <Row k="Claude Agent SDK" v={state ? <Badge status={state.runtime.ready ? 'disponivel' : 'indisponivel'}>{state.runtime.ready ? 'Conectado' : 'Offline'}</Badge> : '…'} />
          {state?.runtime.checkedAt && <p className="xs dim" style={{ marginTop: 6 }}>Última verificação: {dateTime(state.runtime.checkedAt)}. A verificação usa uma chamada mínima ao modelo e não é repetida automaticamente enquanto o runtime está saudável.</p>}
          <Row k="Isolamento dos comandos dos agentes" env="MD2_AGENT_SANDBOX" v={state ? <Badge status={state.sandbox.active ? 'disponivel' : 'indisponivel'}>{state.sandbox.active ? 'Sandbox ativo' : 'Inativo'}</Badge> : '…'} />
          {state && <p className="small muted" style={{ margin: '8px 0' }}>{state.sandbox.detail}</p>}
          <Row k="Modelo do Alfred" env="MD2_MODEL_ALFRED" v={data.models.alfred} />
          <Row k="Modelo dos agentes" env="MD2_MODEL_AGENTS" v={data.models.agents} />
          <button className="btn sm" style={{ marginTop: 12 }} disabled={busy === 'rt'} onClick={() => run('rt', async () => { const r = await api<{ ready: boolean; detail: string }>('/api/runtime/check', {}); return r.detail; })}>Testar conexão agora</button>
        </div>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Limites e custos</h2>
          <Row k="Custo máximo por tarefa" env="MD2_MAX_COST_USD_PER_TASK" v={usd(l.maxCostPerTask)} />
          <Row k="Custo máximo por execução" env="MD2_MAX_COST_USD_PER_EXECUTION" v={usd(l.maxCostPerExecution)} />
          <Row k="Custo máximo por dia" env="MD2_MAX_COST_USD_PER_DAY" v={state ? `${usd(state.costToday)} usados de ${usd(l.maxCostPerDay)}` : usd(l.maxCostPerDay)} />
          <Row k="Tarefas / execuções em paralelo" env="MD2_MAX_PARALLEL_TASKS / _EXECUTIONS" v={`${l.maxParallelTasks} / ${l.maxParallelExecutions}`} />
          <Row k="Tempo limite e tentativas por tarefa" env="MD2_TASK_TIMEOUT_MIN / MD2_TASK_MAX_ATTEMPTS" v={`${l.taskTimeoutMin} min · ${l.taskMaxAttempts}×`} />
          <Row k="Retomadas após reinício" env="MD2_MAX_RECOVERIES" v={`até ${l.maxRecoveries}× por execução`} />
        </div>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Acesso</h2>
          <Row k="Proteção por senha" env="MD2_ADMIN_PASSWORD" v={<Badge status={data.authRequired ? 'disponivel' : 'para_revisao'}>{data.authRequired ? 'Ativa' : 'Desativada (somente local)'}</Badge>} />
          <Row k="Endereço" env="MD2_HOST / MD2_PORT" v={`${data.host}:${data.port}`} />
          <div style={{ padding: '10px 0' }}>
            <div>Pastas locais autorizadas para leitura<div className="mono dim">MD2_AUTHORIZED_DIRS</div></div>
            {data.authorizedDirs.length ? <ul className="mono muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{data.authorizedDirs.map((d) => <li key={d}>{d}</li>)}</ul>
              : <p className="small muted" style={{ marginTop: 6 }}>Nenhuma. Os agentes só acessam arquivos que você anexar na conversa.</p>}
          </div>
        </div>
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <h2 className="grow">Backups</h2>
          {backups.data && <span className="xs dim">automático a cada {backups.data.intervalHours} h · mantém {backups.data.keep} · <span className="mono">{backups.data.dir}</span></span>}
          <button className="btn sm primary" disabled={busy === 'bk'} onClick={() => run('bk', async () => { const r = await api<Snapshot>('/api/backups', {}); backups.reload(); health.reload(); return `Backup ${r.name} criado e ${r.verified ? 'verificado' : 'NÃO verificado'}.`; })}>{busy === 'bk' ? 'Criando…' : 'Fazer backup agora'}</button>
        </div>
        {!backups.data ? <Loading rows={1} h={40} /> : !backups.data.snapshots.length ? <p className="small muted">Nenhum backup ainda. O primeiro é criado automaticamente alguns segundos após o servidor iniciar.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Snapshot</th><th>Situação</th><th className="hide-sm">Banco</th><th className="hide-sm">Execuções / entregáveis</th><th></th></tr></thead>
              <tbody>{backups.data.snapshots.map((b) => (
                <tr key={b.name} style={{ cursor: 'default' }}>
                  <td className="mono">{b.name}</td>
                  <td><Badge status={b.verified ? 'concluido' : 'falhou'}>{b.verified ? 'Verificado' : 'Não verificado'}</Badge></td>
                  <td className="hide-sm muted small">{Math.round(b.db.bytes / 1024)} KB · {b.db.integrity}</td>
                  <td className="hide-sm muted small">{b.counts.executions} / {b.counts.deliverables}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn ghost sm" disabled={busy === b.name} onClick={() => run(b.name, async () => { const v = await api<{ ok: boolean; problems: string[] }>(`/api/backups/${b.name}/verify`, {}); return v.ok ? `Snapshot ${b.name} íntegro.` : `Snapshot ${b.name} com problemas: ${v.problems.join('; ')}`; })}>Verificar</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card pad" style={{ marginTop: 14 }}>
        <div className="row" style={{ marginBottom: 10 }}><h2 className="grow">Consumo</h2>{costs.data && <span className="small muted">hoje {usd(costs.data.today)} · total {usd(costs.data.total)}</span>}</div>
        {!costs.data ? <Loading rows={2} h={40} /> : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <div style={{ overflowX: 'auto' }}>
              <div className="label" style={{ marginBottom: 6 }}>Por agente</div>
              <table className="table"><thead><tr><th>Agente</th><th>Tarefas</th><th>Total</th><th className="hide-sm">Média</th></tr></thead>
                <tbody>{costs.data.byAgent.map((a) => <tr key={a.agent_id} style={{ cursor: 'default' }}><td>{a.agent_id}</td><td className="muted">{a.tasks}</td><td>{usd(a.cost_usd)}</td><td className="hide-sm muted">{usd(a.avg_cost_usd)}</td></tr>)}</tbody></table>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <div className="label" style={{ marginBottom: 6 }}>Tarefas que merecem atenção</div>
              {costs.data.flagged.length ? <table className="table"><thead><tr><th>Tarefa</th><th>Motivo</th><th>Custo</th></tr></thead>
                <tbody>{costs.data.flagged.map((t) => <tr key={t.id} style={{ cursor: 'default' }}><td><div className="truncate" style={{ maxWidth: 240 }}>{t.title}</div><div className="xs dim">{t.agent_id} · {t.turns} etapas · {t.attempt} tentativa(s)</div></td><td><Badge status="para_revisao">{t.motivo}</Badge></td><td>{usd(t.cost_usd)}</td></tr>)}</tbody></table>
                : <p className="small muted">Nenhuma tarefa acima de 60% do teto por tarefa, com excesso de etapas ou com várias tentativas.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
