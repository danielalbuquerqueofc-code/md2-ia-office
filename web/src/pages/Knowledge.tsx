import { useEffect, useState } from 'react';
import { api, useData } from '../api';
import { Empty, Icon, Loading, Markdown, Modal } from '../ui';

interface Doc { id: string; department: string; title: string; summary: string; tags: string[]; updated: string }
interface Hit { docId: string; title: string; heading: string; text: string; score: number }
interface SkillInfo { id: string; name: string; department: string; description: string; owners: string[]; triggers: string[]; inputs: string[]; tools: string[]; outputs: string[]; body: string }

export function Knowledge() {
  const [tab, setTab] = useState<'biblioteca' | 'skills'>('biblioteca');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [skill, setSkill] = useState<SkillInfo | null>(null);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useData<{ docs: Doc[]; hits: Hit[] }>(`/api/knowledge?q=${encodeURIComponent(query)}`, () => false);
  const { data: sk } = useData<{ skills: SkillInfo[] }>('/api/skills', () => false);
  const open = (id: string) => api<{ title: string; body: string }>(`/api/knowledge/doc?id=${encodeURIComponent(id)}`).then(setDoc);
  const depts = [...new Set(data?.docs.map((d) => d.department))];
  const skillDepts = [...new Set(sk?.skills.map((s) => s.department))];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Conhecimento</h1><p>Bibliotecas por departamento e skills executáveis. Alfred e os agentes consultam este acervo automaticamente em cada tarefa.</p></div>
        <div className="spacer" />
        <div className="tabs">
          <button className={`tab ${tab === 'biblioteca' ? 'active' : ''}`} onClick={() => setTab('biblioteca')}>Biblioteca ({data?.docs.length ?? 0})</button>
          <button className={`tab ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>Skills ({sk?.skills.length ?? 0})</button>
        </div>
      </div>
      {tab === 'biblioteca' ? (
        <>
          <div style={{ position: 'relative', maxWidth: 520, marginBottom: 22 }}>
            <span style={{ position: 'absolute', left: 11, top: 9, color: 'var(--text-3)' }}><Icon name="search" /></span>
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar no conhecimento (ex.: precificação, reels, LGPD)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no conhecimento" />
          </div>
          {!data ? <Loading /> : query ? (
            data.hits.length ? <div className="col">{data.hits.map((h, i) => (
              <button key={i} className="card pad click" onClick={() => open(h.docId)}>
                <div className="row"><b style={{ fontWeight: 600 }}>{h.heading}</b><span className="xs dim">{h.title}</span></div>
                <p className="small muted" style={{ marginTop: 6 }}>{h.text.replace(/^##.*\n/, '').slice(0, 300)}…</p>
              </button>
            ))}</div> : <Empty title="Nada encontrado">Tente outros termos.</Empty>
          ) : depts.map((d) => (
            <section key={d} style={{ marginBottom: 24 }}>
              <div className="label" style={{ marginBottom: 10 }}>{d}</div>
              <div className="grid c3">{data.docs.filter((x) => x.department === d).map((x) => (
                <button key={x.id} className="card pad click" onClick={() => open(x.id)}>
                  <div style={{ fontWeight: 600 }}>{x.title}</div>
                  <p className="small muted" style={{ margin: '6px 0 12px' }}>{x.summary}</p>
                  <div className="tags">{x.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}</div>
                </button>
              ))}</div>
            </section>
          ))}
        </>
      ) : !sk ? <Loading /> : skillDepts.map((d) => (
        <section key={d} style={{ marginBottom: 24 }}>
          <div className="label" style={{ marginBottom: 10 }}>{d}</div>
          <div className="grid c3">{sk.skills.filter((s) => s.department === d).map((s) => (
            <button key={s.id} className="card pad click" onClick={() => setSkill(s)}>
              <div className="row"><b style={{ fontWeight: 600 }} className="grow">{s.name}</b><span className="mono dim">{s.id}</span></div>
              <p className="small muted" style={{ margin: '6px 0 12px' }}>{s.description}</p>
              <div className="tags">{s.owners.map((o) => <span key={o} className="tag">{o}</span>)}</div>
            </button>
          ))}</div>
        </section>
      ))}
      {doc && <Modal title={doc.title} onClose={() => setDoc(null)}><div className="modal-body"><Markdown text={doc.body} /></div></Modal>}
      {skill && (
        <Modal title={<span>{skill.name} <span className="mono dim">{skill.id}</span></span>} onClose={() => setSkill(null)}>
          <div className="modal-body col" style={{ gap: 16 }}>
            <p>{skill.description}</p>
            <dl className="kv">
              <dt>Responsáveis</dt><dd>{skill.owners.join(', ')}</dd>
              <dt>Gatilhos</dt><dd>{skill.triggers.join(' · ')}</dd>
              <dt>Entradas</dt><dd>{skill.inputs.join(' · ')}</dd>
              <dt>Ferramentas</dt><dd>{skill.tools.join(', ')}</dd>
              <dt>Saídas</dt><dd>{skill.outputs.join(' · ')}</dd>
            </dl>
            <Markdown text={skill.body} />
          </div>
        </Modal>
      )}
    </div>
  );
}
