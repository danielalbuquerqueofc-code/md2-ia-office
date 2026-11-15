import { useState } from 'react';
import { useData } from '../api';
import { go } from '../App';
import { dateTime, Empty, Loading } from '../ui';

interface Conv { id: string; title: string; updated_at: string }
interface Audit { id: number; actor: string; action: string; detail: string | null; created_at: string }
const ACTION: Record<string, string> = {
  mensagem: 'Enviou ordem ao Alfred', upload: 'Enviou arquivo', login: 'Entrou no sistema', login_falhou: 'Tentativa de acesso recusada', cancelar_execucao: 'Cancelou execução',
  aprovacao_aprovar: 'Aprovou ação', aprovacao_rejeitar: 'Rejeitou ação', entregavel_aprovar: 'Aprovou entregável', entregavel_ajustar: 'Solicitou ajustes em entregável',
};

export function History() {
  const [tab, setTab] = useState<'conversas' | 'auditoria'>('conversas');
  const { data: convs } = useData<Conv[]>('/api/conversations', (e) => e.type === 'mensagem');
  const { data: audit } = useData<Audit[]>(tab === 'auditoria' ? '/api/audit' : null, () => false);
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div><h1>Histórico</h1><p>Conversas com Alfred e trilha de auditoria de todas as decisões humanas.</p></div>
        <div className="spacer" />
        <div className="tabs">
          <button className={`tab ${tab === 'conversas' ? 'active' : ''}`} onClick={() => setTab('conversas')}>Conversas</button>
          <button className={`tab ${tab === 'auditoria' ? 'active' : ''}`} onClick={() => setTab('auditoria')}>Auditoria</button>
        </div>
      </div>
      {tab === 'conversas' ? (!convs ? <Loading /> : !convs.length ? <Empty title="Nenhuma conversa ainda" /> : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table"><tbody>{convs.map((c) => (
            <tr key={c.id} onClick={() => go(`comando/${c.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`comando/${c.id}`)}>
              <td><div className="truncate" style={{ fontWeight: 500, maxWidth: 620 }}>{c.title}</div></td><td className="muted small" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{dateTime(c.updated_at)}</td>
            </tr>
          ))}</tbody></table>
        </div>
      )) : !audit ? <Loading /> : !audit.length ? <Empty title="Sem registros" /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table"><thead><tr><th>Quando</th><th>Ação</th><th className="hide-sm">Detalhe</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id} style={{ cursor: 'default' }}><td className="muted small" style={{ whiteSpace: 'nowrap' }}>{dateTime(a.created_at)}</td><td>{ACTION[a.action] ?? a.action}</td><td className="hide-sm mono dim" style={{ maxWidth: 420 }}><div className="truncate">{a.detail}</div></td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}
