import type { AppState } from '../api';
import { useData } from '../api';
import { Badge, Loading, usd } from '../ui';

interface SettingsData {
  authRequired: boolean; host: string; port: number; authorizedDirs: string[]; models: { alfred: string; agents: string };
  limits: { maxParallelTasks: number; maxParallelExecutions: number; taskTimeoutMin: number; taskMaxTurns: number; taskMaxAttempts: number; maxCostPerExecution: number; maxCostPerDay: number };
}
const Row = ({ k, v, env }: { k: string; v: React.ReactNode; env?: string }) => (
  <div className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}><span className="grow">{k}{env && <div className="mono dim">{env}</div>}</span><span className="muted" style={{ textAlign: 'right' }}>{v}</span></div>
);

export function Settings({ state }: { state: AppState | null }) {
  const { data } = useData<SettingsData>('/api/settings', () => false);
  if (!data) return <div className="page"><Loading /></div>;
  const l = data.limits;
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <div className="page-head"><div><h1>Configurações</h1><p>Valores lidos do arquivo <code>.env</code> no servidor. Credenciais nunca são exibidas nem enviadas ao navegador. Para alterar, edite o <code>.env</code> e reinicie o serviço.</p></div></div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Runtime dos agentes</h2>
          <Row k="Claude Agent SDK" v={state ? <Badge status={state.runtime.ready ? 'disponivel' : 'indisponivel'}>{state.runtime.ready ? 'Conectado' : 'Offline'}</Badge> : '…'} />
          {state && <p className="small muted" style={{ margin: '10px 0' }}>{state.runtime.detail}</p>}
          <Row k="Modelo do Alfred" env="MD2_MODEL_ALFRED" v={data.models.alfred} />
          <Row k="Modelo dos agentes" env="MD2_MODEL_AGENTS" v={data.models.agents} />
          <Row k="Gasto de hoje" v={state ? `${usd(state.costToday)} de ${usd(l.maxCostPerDay)}` : '…'} />
        </div>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Limites e custos</h2>
          <Row k="Tarefas em paralelo" env="MD2_MAX_PARALLEL_TASKS" v={l.maxParallelTasks} />
          <Row k="Execuções em paralelo" env="MD2_MAX_PARALLEL_EXECUTIONS" v={l.maxParallelExecutions} />
          <Row k="Tempo limite por tarefa" env="MD2_TASK_TIMEOUT_MIN" v={`${l.taskTimeoutMin} min`} />
          <Row k="Tentativas por tarefa" env="MD2_TASK_MAX_ATTEMPTS" v={l.taskMaxAttempts} />
          <Row k="Custo máximo por execução" env="MD2_MAX_COST_USD_PER_EXECUTION" v={usd(l.maxCostPerExecution)} />
          <Row k="Custo máximo por dia" env="MD2_MAX_COST_USD_PER_DAY" v={usd(l.maxCostPerDay)} />
        </div>
        <div className="card pad">
          <h2 style={{ marginBottom: 8 }}>Acesso e segurança</h2>
          <Row k="Proteção por senha" env="MD2_ADMIN_PASSWORD" v={<Badge status={data.authRequired ? 'disponivel' : 'para_revisao'}>{data.authRequired ? 'Ativa' : 'Desativada (somente local)'}</Badge>} />
          <Row k="Endereço" env="MD2_HOST / MD2_PORT" v={`${data.host}:${data.port}`} />
          <div style={{ padding: '10px 0' }}>
            <div>Pastas locais autorizadas para leitura<div className="mono dim">MD2_AUTHORIZED_DIRS</div></div>
            {data.authorizedDirs.length ? <ul className="mono muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>{data.authorizedDirs.map((d) => <li key={d}>{d}</li>)}</ul>
              : <p className="small muted" style={{ marginTop: 6 }}>Nenhuma. Os agentes só acessam arquivos que você anexar na conversa.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
