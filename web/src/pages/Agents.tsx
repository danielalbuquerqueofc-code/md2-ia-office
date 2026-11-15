import { useState } from 'react';
import type { Agent } from '../api';
import { useData } from '../api';
import { go } from '../App';
import { Avatar, Badge, Loading, Modal } from '../ui';

interface SkillInfo { id: string; name: string; description: string }
const List = ({ title, items }: { title: string; items: string[] }) => (
  <div><div className="label" style={{ marginBottom: 6 }}>{title}</div><ul style={{ margin: 0, paddingLeft: 18 }} className="small muted">{items.map((i) => <li key={i} style={{ marginTop: 3 }}>{i}</li>)}</ul></div>
);

export function Agents({ agents }: { agents: Agent[] }) {
  const [open, setOpen] = useState<Agent | null>(null);
  const { data: skills } = useData<{ skills: SkillInfo[] }>('/api/skills', () => false);
  const departments = [...new Map(agents.map((a) => [a.department, a.departmentName])).entries()];
  const skillName = (id: string) => skills?.skills.find((s) => s.id === id)?.name ?? id;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Equipe de Agentes</h1><p>22 especialistas coordenados por Alfred. Você não conversa com eles individualmente: Alfred escolhe quem atua em cada pedido.</p></div>
        <div className="spacer" />
        <Badge>{agents.filter((a) => a.currentTask).length} trabalhando agora</Badge>
      </div>
      {!agents.length ? <Loading rows={4} h={120} /> : departments.map(([id, name]) => (
        <section key={id} style={{ marginBottom: 26 }}>
          <div className="label" style={{ marginBottom: 10 }}>{name}</div>
          <div className="grid c3">
            {agents.filter((a) => a.department === id).map((a) => (
              <button key={a.id} className="card pad click" onClick={() => setOpen(a)}>
                <div className="row">
                  <Avatar name={a.name} />
                  <div className="grow"><div style={{ fontWeight: 600 }}>{a.name}</div><div className="small muted truncate">{a.role}</div></div>
                  {a.currentTask ? <Badge status="executando">Em tarefa</Badge> : <Badge status="disponivel" />}
                </div>
                <p className="small muted" style={{ margin: '12px 0' }}>{a.specialty}</p>
                {a.currentTask ? <div className="small truncate" style={{ color: 'var(--primary)' }}>{a.currentTask.title}</div>
                  : <div className="tags">{a.skills.slice(0, 3).map((s) => <span key={s} className="tag">{skillName(s)}</span>)}</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
      {open && (
        <Modal onClose={() => setOpen(null)} title={<span className="row"><Avatar name={open.name} sm /> {open.name} <span className="muted" style={{ fontWeight: 400 }}>· {open.role}</span></span>}
          footer={open.currentTask ? <button className="btn" onClick={() => go(`execucoes/${open.currentTask!.execution_id}`)}>Ver execução atual</button> : undefined}>
          <div className="modal-body col" style={{ gap: 18 }}>
            <p>{open.specialty}</p>
            {open.provisionalName && <div className="banner">O nome deste agente é provisório: o cadastro original não estava no repositório. Edite <code>agents/registry.json</code> para ajustar nome e função.</div>}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Badge>{open.departmentName}</Badge>
              {open.currentTask ? <Badge status="executando">{open.currentTask.title}</Badge> : <Badge status="disponivel" />}
              <span className="small muted">{open.completedTasks} tarefa{open.completedTasks === 1 ? '' : 's'} concluída{open.completedTasks === 1 ? '' : 's'}</span>
            </div>
            <List title="Capacidades" items={open.capabilities} />
            <div><div className="label" style={{ marginBottom: 6 }}>Skills</div><div className="tags">{open.skills.map((s) => <span key={s} className="tag">{skillName(s)}</span>)}</div></div>
            <div><div className="label" style={{ marginBottom: 6 }}>Ferramentas autorizadas</div><div className="tags">{open.tools.map((t) => <Badge key={t.id} status={t.status}>{t.name}</Badge>)}</div></div>
            <div><div className="label" style={{ marginBottom: 6 }}>Bibliotecas de conhecimento</div><div className="tags">{open.knowledge.map((k) => <span key={k} className="tag">{k}</span>)}</div></div>
            <List title="Instruções permanentes" items={open.instructions} />
            <List title="Critérios de qualidade" items={open.quality} />
            {open.limits.length > 0 && <List title="Limites específicos" items={open.limits} />}
          </div>
        </Modal>
      )}
    </div>
  );
}
