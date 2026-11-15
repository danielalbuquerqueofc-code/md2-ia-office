import { useState } from 'react';
import type { Agent, Approval, Deliverable } from '../api';
import { useData } from '../api';
import { DeliverablePreview, KIND_ICON } from '../components/DeliverablePreview';
import { ApprovalRow } from '../components/ExecutionCard';
import { Badge, Empty, Icon, Loading } from '../ui';

export function Approvals({ agents }: { agents: Agent[] }) {
  const { data, reload } = useData<Approval[]>('/api/approvals', (e) => e.type === 'aprovacao');
  const { data: dv, reload: reloadDv } = useData<Deliverable[]>('/api/deliverables', (e) => e.type === 'entregavel');
  const [open, setOpen] = useState<Deliverable | null>(null);
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? undefined;
  const pending = data?.filter((a) => a.status === 'pendente') ?? [];
  const decided = data?.filter((a) => a.status !== 'pendente') ?? [];
  const review = dv?.filter((d) => d.status === 'para_revisao') ?? [];
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head"><div><h1>Aprovações</h1><p>Publicações, envios externos, gastos, contratações, alterações financeiras e exclusões só acontecem com a sua autorização. Os agentes preparam; você decide.</p></div></div>
      {!data || !dv ? <Loading /> : (
        <div className="col" style={{ gap: 26 }}>
          <section>
            <div className="label" style={{ marginBottom: 10 }}>Ações aguardando autorização ({pending.length})</div>
            {pending.length ? <div className="card" style={{ overflow: 'hidden' }}>{pending.map((a) => <ApprovalRow key={a.id} approval={a} agentName={name(a.agent_id)} onDone={reload} />)}</div>
              : <Empty title="Nenhuma ação pendente">Quando um agente precisar publicar, enviar ou gastar, o pedido aparece aqui.</Empty>}
          </section>
          <section>
            <div className="label" style={{ marginBottom: 10 }}>Entregáveis para revisão ({review.length})</div>
            {review.length ? <div className="card" style={{ overflow: 'hidden' }}>{review.map((d) => (
              <button key={d.id} className="dv-chip" onClick={() => setOpen(d)}>
                <span className="dv-icon"><Icon name={KIND_ICON[d.versions[0]?.kind] ?? 'file'} /></span>
                <span className="grow"><span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{d.name}</span><span className="xs dim">{d.client ?? d.category} · {name(d.agent_id)} · versão {d.versions[0]?.version}</span></span>
                <Badge status={d.status} />
              </button>
            ))}</div> : <Empty title="Nada para revisar" />}
          </section>
          {decided.length > 0 && <section><div className="label" style={{ marginBottom: 10 }}>Decisões anteriores</div><div className="card" style={{ overflow: 'hidden' }}>{decided.map((a) => <ApprovalRow key={a.id} approval={a} agentName={name(a.agent_id)} onDone={reload} />)}</div></section>}
        </div>
      )}
      {open && <DeliverablePreview deliverable={open} agentName={name(open.agent_id)} onClose={() => setOpen(null)} onChanged={reloadDv} />}
    </div>
  );
}
