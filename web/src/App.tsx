import { useCallback, useEffect, useState } from 'react';
import type { Agent, AppState } from './api';
import { api, connectStream, disconnectStream, onUnauthorized, useConnected, useData } from './api';
import { Agents } from './pages/Agents';
import { Approvals } from './pages/Approvals';
import { Command } from './pages/Command';
import { Deliverables } from './pages/Deliverables';
import { Executions } from './pages/Executions';
import { History } from './pages/History';
import { Knowledge } from './pages/Knowledge';
import { Settings } from './pages/Settings';
import { Tools } from './pages/Tools';
import { Icon } from './ui';

const NAV = [
  { id: 'comando', label: 'Central de Comando', icon: 'command' },
  { id: 'execucoes', label: 'Execuções', icon: 'executions' },
  { id: 'equipe', label: 'Equipe de Agentes', icon: 'team' },
  { id: 'conhecimento', label: 'Conhecimento', icon: 'knowledge' },
  { id: 'ferramentas', label: 'Ferramentas', icon: 'tools' },
  { id: 'entregaveis', label: 'Entregáveis', icon: 'deliverables' },
  { id: 'historico', label: 'Histórico', icon: 'history' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
];
const TITLES: Record<string, string> = { ...Object.fromEntries(NAV.map((n) => [n.id, n.label])), aprovacoes: 'Aprovações' };

function useRoute() {
  const parse = () => { const [page = 'comando', param] = location.hash.replace(/^#\/?/, '').split('/'); return { page: page || 'comando', param }; };
  const [route, setRoute] = useState(parse);
  useEffect(() => { const h = () => setRoute(parse()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return route;
}
export const go = (path: string) => { location.hash = `#/${path}`; };

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form className="card pad col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError('');
        try { await api('/api/login', { password }); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <div className="row"><span className="brand-mark"><Icon name="alfred" size={16} /></span><b>MD2 <span className="dim" style={{ fontWeight: 400 }}>IA Office</span></b></div>
        <div><h2>Acesso restrito</h2><p className="muted small" style={{ marginTop: 4 }}>Informe a senha de administrador para falar com Alfred.</p></div>
        <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Senha" />
        {error && <div className="banner err">{error}</div>}
        <button className="btn primary" disabled={busy || !password}>Entrar</button>
      </form>
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<{ authenticated: boolean; authRequired: boolean } | null>(null);
  const check = useCallback(() => api<{ authenticated: boolean; authRequired: boolean }>('/api/session').then(setSession).catch(() => setSession({ authenticated: false, authRequired: true })), []);
  useEffect(() => { void check(); return onUnauthorized(() => setSession({ authenticated: false, authRequired: true })); }, [check]);
  useEffect(() => { if (session?.authenticated) { connectStream(); return disconnectStream; } }, [session?.authenticated]);
  if (!session) return null;
  if (!session.authenticated) return <Login onDone={check} />;
  return <Shell authRequired={session.authRequired} onLogout={() => api('/api/logout', {}).then(check)} />;
}

function Shell({ authRequired, onLogout }: { authRequired: boolean; onLogout: () => void }) {
  const { page, param } = useRoute();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('md2.sidebar') === '1');
  const [open, setOpen] = useState(false);
  const connected = useConnected();
  const { data: state } = useData<AppState>('/api/state', (e) => ['status', 'aprovacao', 'entregavel'].includes(e.type));
  const { data: team } = useData<{ agents: Agent[] }>('/api/agents', (e) => e.type === 'tarefa' || e.type === 'erro');
  const agents = team?.agents ?? [];
  useEffect(() => { localStorage.setItem('md2.sidebar', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => setOpen(false), [page, param]);
  const working = agents.filter((a) => a.currentTask).length;
  const pending = (state?.counts.approvals ?? 0) + (state?.counts.review ?? 0);

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${open ? 'open' : ''}`} onClick={(e) => { if (open && e.target === e.currentTarget) setOpen(false); }}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="alfred" size={16} /></span><span className="brand-name">MD2 <span>IA Office</span></span></div>
        <nav className="nav" aria-label="Principal">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-item ${page === n.id ? 'active' : ''}`} onClick={() => go(n.id)} title={n.label} aria-current={page === n.id ? 'page' : undefined}>
              <Icon name={n.icon} /><span>{n.label}</span>
              {n.id === 'execucoes' && !!state?.counts.running && <span className="count">{state.counts.running}</span>}
              {n.id === 'entregaveis' && !!state?.counts.review && <span className="count">{state.counts.review}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item collapse-btn" onClick={() => setCollapsed(!collapsed)} title="Recolher menu"><Icon name="sidebar" /><span>Recolher</span></button>
          {authRequired && <button className="nav-item" onClick={onLogout} title="Sair"><Icon name="logout" /><span>Sair</span></button>}
        </div>
      </aside>
      <div className="main">
        <header className="header">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <h1 className="truncate">{TITLES[page] ?? 'MD2 IA Office'}</h1>
          <div className="spacer" />
          {state && !state.runtime.ready && <span className="status-chip" title={state.runtime.detail}><i className="pulse err" /> Runtime offline</span>}
          <button className="status-chip" onClick={() => go('execucoes')} title={connected ? 'Conectado em tempo real' : 'Reconectando…'} style={{ cursor: 'pointer' }}>
            <i className={`pulse ${state?.counts.running ? 'on' : connected ? 'ok' : ''}`} />
            {state?.counts.running ? <>{state.counts.running} <span className="long">em execução · {working} agente{working === 1 ? '' : 's'} ativo{working === 1 ? '' : 's'}</span></> : <span>Equipe disponível</span>}
          </button>
          <button className="icon-btn" onClick={() => go('aprovacoes')} aria-label={`Aprovações e revisões pendentes: ${pending}`} title="Aprovações"><Icon name="bell" />{pending > 0 && <span className="dot">{pending}</span>}</button>
          <span className="avatar gold" title="Administrador" style={{ fontSize: 11 }}>MD</span>
        </header>
        <main className="content">
          {page === 'comando' && <Command conversationId={param} agents={agents} runtime={state?.runtime} />}
          {page === 'execucoes' && <Executions selected={param} agents={agents} />}
          {page === 'equipe' && <Agents agents={agents} />}
          {page === 'conhecimento' && <Knowledge />}
          {page === 'ferramentas' && <Tools />}
          {page === 'entregaveis' && <Deliverables agents={agents} />}
          {page === 'aprovacoes' && <Approvals agents={agents} />}
          {page === 'historico' && <History />}
          {page === 'configuracoes' && <Settings state={state} />}
        </main>
      </div>
    </div>
  );
}
