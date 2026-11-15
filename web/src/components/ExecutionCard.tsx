import { useEffect, useRef, useState } from 'react';
import type { Agent, Approval, Deliverable, ExecutionDetail, LiveEvent } from '../api';
import { api, useData, useLiveEvents } from '../api';
import { ACTIVE, Avatar, Badge, Icon, PIPELINE, STATUS, time, usd } from '../ui';
import { DeliverablePreview, KIND_ICON } from './DeliverablePreview';

export function ApprovalRow({ approval: a, agentName, onDone }: { approval: Approval; agentName?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (decision: 'aprovar' | 'rejeitar') => {
    setBusy(true); setError('');
    try { await api(`/api/approvals/${a.id}/decision`, { decision }); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="approval">
      <span className="dv-icon" style={{ background: 'rgba(233,162,59,.12)', color: 'var(--warning)' }}><Icon name="shield" /></span>
      <div className="grow">
        <div className="row" style={{ flexWrap: 'wrap' }}><b style={{ fontWeight: 600 }}>{a.title}</b><Badge status={a.status} />{agentName && <span className="xs dim">solicitado por {agentName}</span>}</div>
        <p className="small muted" style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{a.description}</p>
        {a.payload && <pre className="mono muted" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{a.payload}</pre>}
        {a.outcome && <p className="small" style={{ marginTop: 6 }}>{a.outcome}</p>}
        {error && <p className="small" style={{ color: 'var(--error)', marginTop: 6 }}>{error}</p>}
        {a.status === 'pendente' && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary sm" disabled={busy} onClick={() => decide('aprovar')}>Aprovar</button>
            <button className="btn sm" disabled={busy} onClick={() => decide('rejeitar')}>Rejeitar</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Painel de uma execução: etapas, tarefas por agente, atividade ao vivo, aprovações e entregáveis. Tudo vem do banco e do stream. */
export function ExecutionCard({ executionId, agents, defaultOpen }: { executionId: string; agents: Agent[]; defaultOpen?: boolean }) {
  const { data, reload } = useData<ExecutionDetail>(`/api/executions/${executionId}`, (e) => e.execution_id === executionId || e.type === 'entregavel');
  const [live, setLive] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(!!defaultOpen);
  const [preview, setPreview] = useState<Deliverable | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  useLiveEvents((e: LiveEvent) => {
    if (e.execution_id === executionId && e.task_id && (e.type === 'atividade' || e.type === 'log')) setLive((l) => ({ ...l, [e.task_id!]: e.message }));
  });
  useEffect(() => { if (open && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [open, data?.events.length]);
  if (!data) return <div className="skeleton" style={{ height: 96 }} />;

  const { execution: x, tasks, events, approvals, deliverables } = data;
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? (id ? id : 'Alfred');
  const active = ACTIVE.includes(x.status);
  const idx = PIPELINE.indexOf(x.status === 'aguardando_aprovacao' ? 'validando' : x.status);
  const done = tasks.filter((t) => t.status === 'concluida').length;
  const lastStatus = [...events].reverse().find((e) => e.type === 'status' || e.type === 'plano')?.message;

  return (
    <div className="exec">
      <div className="exec-head">
        <Avatar name="Alfred" gold sm />
        <div className="grow">
          <div className="truncate" style={{ fontWeight: 500 }}>{x.objective ?? lastStatus ?? 'Alfred recebeu a solicitação.'}</div>
          <div className="xs dim">{tasks.length ? `${done} de ${tasks.length} tarefas concluídas` : (lastStatus ?? '')}{x.cost_usd > 0 && ` · ${usd(x.cost_usd)}`}</div>
        </div>
        <Badge status={x.status} />
        {active && <button className="btn ghost sm danger" onClick={() => api(`/api/executions/${x.id}/cancel`, {}).then(reload)}>Cancelar</button>}
      </div>
      <div className="exec-steps" title={STATUS[x.status]?.label}>
        {PIPELINE.map((s, i) => <i key={s} className={x.status === 'falhou' || x.status === 'cancelado' ? (i <= Math.max(idx, 1) ? 'fail' : '') : i < idx || x.status === 'concluido' ? 'done' : i === idx ? 'now' : ''} />)}
      </div>
      {x.error && <div className="exec-section" style={{ padding: '10px 14px' }}><div className="banner err">{x.error}</div></div>}
      {tasks.length > 0 && (
        <div className="exec-section">
          {tasks.map((t) => (
            <div className="task" key={t.id}>
              <Avatar name={name(t.agent_id)} sm />
              <div className="grow">
                <div className="row"><span className="t-title truncate">{t.title}</span></div>
                <div className="t-live">
                  {t.status === 'executando' && <span className="spinner" />}
                  <span className="truncate">{name(t.agent_id)}{t.status === 'executando' ? ` · ${live[t.id] ?? 'trabalhando…'}` : t.attempt > 1 ? ` · ${t.attempt} tentativas` : ''}</span>
                </div>
                {t.error && t.status !== 'concluida' && <div className="t-err">{t.error}</div>}
              </div>
              <Badge status={t.status} />
            </div>
          ))}
        </div>
      )}
      {approvals.length > 0 && <div className="exec-section">{approvals.map((a) => <ApprovalRow key={a.id} approval={a} agentName={name(a.agent_id)} onDone={reload} />)}</div>}
      {deliverables.length > 0 && (
        <div className="exec-section">
          {deliverables.map((d) => (
            <button key={d.id} className="dv-chip" onClick={() => setPreview(d)}>
              <span className="dv-icon"><Icon name={KIND_ICON[d.versions[0]?.kind] ?? 'file'} /></span>
              <span className="grow"><span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{d.name}</span><span className="xs dim">Versão {d.versions[0]?.version} · {name(d.agent_id)} · clique para ver a prévia</span></span>
              <Badge status={d.status} />
            </button>
          ))}
        </div>
      )}
      <div className="exec-section">
        <button className="exec-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'grid', transition: 'transform 180ms' }}><Icon name="chevron" size={14} /></span>
          Atividade e logs ({events.length})
        </button>
        {open && (
          <div className="log" ref={logRef}>
            {events.map((e) => (
              <div key={e.id} className={`log-line ${e.type}`}>
                <span className="dim mono">{time(e.created_at)}</span><span className="who">{name(e.agent_id)}</span><span className="what">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {preview && <DeliverablePreview deliverable={preview} agentName={name(preview.agent_id)} onClose={() => setPreview(null)} onChanged={reload} />}
    </div>
  );
}
