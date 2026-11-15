import { useState } from 'react';
import type { Agent, Deliverable } from '../api';
import { useData } from '../api';
import { CATEGORY_LABEL, DeliverablePreview, KIND_ICON } from '../components/DeliverablePreview';
import { Badge, dateTime, Empty, Icon, Loading } from '../ui';

function Thumb({ d }: { d: Deliverable }) {
  const v = d.versions[0];
  if (!v) return <div className="dv-thumb"><Icon name="file" size={28} /></div>;
  return (
    <div className="dv-thumb">
      {v.kind === 'imagem' ? <img src={v.url} alt="" loading="lazy" />
        : v.kind === 'video' ? <video src={`${v.url}#t=0.5`} muted preload="metadata" />
        : v.kind === 'site' || v.kind === 'pagina' ? <iframe src={v.url} title="" sandbox="" loading="lazy" tabIndex={-1} aria-hidden="true" />
        : <Icon name={KIND_ICON[v.kind] ?? 'file'} size={28} />}
    </div>
  );
}

export function Deliverables({ agents }: { agents: Agent[] }) {
  const { data, reload } = useData<Deliverable[]>('/api/deliverables', (e) => e.type === 'entregavel');
  const [cat, setCat] = useState('todos');
  const [open, setOpen] = useState<Deliverable | null>(null);
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? '—';
  const cats = Object.keys(CATEGORY_LABEL).filter((c) => data?.some((d) => d.category === c));
  const list = data?.filter((d) => cat === 'todos' || d.category === cat) ?? [];
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Entregáveis</h1><p>Arquivos reais produzidos pela equipe, com prévia, histórico de versões e aprovação. Cada versão é um snapshot imutável.</p></div>
        <div className="spacer" />
        <div className="tabs">
          <button className={`tab ${cat === 'todos' ? 'active' : ''}`} onClick={() => setCat('todos')}>Todos ({data?.length ?? 0})</button>
          {cats.map((c) => <button key={c} className={`tab ${cat === c ? 'active' : ''}`} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>)}
        </div>
      </div>
      {!data ? <Loading rows={2} h={220} /> : !list.length ? <Empty title="Nenhum entregável ainda">Quando a equipe concluir um site, vídeo, proposta ou documento, ele aparece aqui com prévia.</Empty> : (
        <div className="grid c4">
          {list.map((d) => (
            <button key={d.id} className="card click" style={{ padding: 0 }} onClick={() => setOpen(d)}>
              <Thumb d={d} />
              <div style={{ padding: 14 }} className="col">
                <div className="row"><b className="grow truncate" style={{ fontWeight: 600 }}>{d.name}</b></div>
                <div className="small muted truncate">{d.client ?? CATEGORY_LABEL[d.category]} · {name(d.agent_id)}</div>
                <div className="row"><Badge status={d.status} /><span className="xs dim grow" style={{ textAlign: 'right' }}>v{d.versions[0]?.version} · {dateTime(d.updated_at)}</span></div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <DeliverablePreview deliverable={open} agentName={name(open.agent_id)} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
