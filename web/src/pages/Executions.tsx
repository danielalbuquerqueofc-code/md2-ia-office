import type { Agent, Execution } from '../api';
import { useData } from '../api';
import { go } from '../App';
import { ExecutionCard } from '../components/ExecutionCard';
import { Badge, dateTime, Empty, Icon, Loading, usd } from '../ui';

export function Executions({ selected, agents }: { selected?: string; agents: Agent[] }) {
  const { data } = useData<Execution[]>('/api/executions', (e) => e.type === 'status' || e.type === 'tarefa');
  const current = data?.find((x) => x.id === selected);
  if (selected) {
    return (
      <div className="page" style={{ maxWidth: 980 }}>
        <div className="page-head">
          <div className="grow">
            <button className="btn ghost sm" onClick={() => go('execucoes')} style={{ marginLeft: -10, marginBottom: 6 }}>← Todas as execuções</button>
            <h1>{current?.conversation_title ?? 'Execução'}</h1>
            {current && <p>{current.request}</p>}
          </div>
          {current && <button className="btn" onClick={() => go(`comando/${current.conversation_id}`)}><Icon name="command" size={15} /> Abrir conversa</button>}
        </div>
        <ExecutionCard executionId={selected} agents={agents} defaultOpen />
      </div>
    );
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1>Execuções</h1><p>Tudo o que Alfred recebeu, com responsável, etapas, progresso, erros e custo. As execuções continuam rodando mesmo com esta tela fechada.</p></div></div>
      {!data ? <Loading /> : !data.length ? <Empty title="Nenhuma execução ainda">Envie uma ordem ao Alfred na Central de Comando.</Empty> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Pedido</th><th>Status</th><th>Progresso</th><th className="hide-sm">Custo</th><th className="hide-sm">Início</th></tr></thead>
            <tbody>
              {data.map((x) => (
                <tr key={x.id} onClick={() => go(`execucoes/${x.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`execucoes/${x.id}`)}>
                  <td style={{ maxWidth: 460 }}><div className="truncate" style={{ fontWeight: 500 }}>{x.conversation_title}</div><div className="truncate small muted">{x.request}</div></td>
                  <td><Badge status={x.status} /></td>
                  <td style={{ minWidth: 130 }}>{x.task_count ? <><div className="xs dim" style={{ marginBottom: 5 }}>{x.task_done}/{x.task_count} tarefas</div><div className="progress"><i style={{ width: `${(100 * (x.task_done ?? 0)) / x.task_count}%` }} /></div></> : <span className="dim small">Resposta direta</span>}</td>
                  <td className="hide-sm muted small">{usd(x.cost_usd)}</td>
                  <td className="hide-sm muted small">{dateTime(x.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
