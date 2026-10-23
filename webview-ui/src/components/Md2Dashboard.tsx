import './md2-dashboard.css';

import { useState } from 'react';

const departments = [
  ['Comercial e Vendas', 4, '◈'],
  ['Marketing', 3, '▥'],
  ['Operações', 3, '▤'],
  ['Diretoria e Estratégia', 2, '◇'],
  ['Financeiro', 2, '▣'],
  ['Tecnologia', 4, '⌘'],
  ['Atendimento', 2, '☏'],
] as const;
const steps = [
  ['Você faz o pedido', '✎', 'Descreva o que precisa e o resultado esperado.'],
  ['Diretoria organiza', '◇', 'Planejamento e distribuição das tarefas.'],
  ['Designer planeja', '▧', 'Interface e estrutura da solução.'],
  ['Programador desenvolve', '⌘', 'O Codex executa a tarefa autorizada.'],
  ['Qualidade testa', '✓', 'Os resultados precisam ser verificados.'],
  ['Você aprova', '☑', 'Revise cada ação antes de autorizar.'],
  ['Publicação final', '↗', 'Publicação somente quando autorizada.'],
];
type Task = { id: string; prompt: string; status: string };
const status: Record<string, string> = {
  completed: 'Concluída',
  running: 'Em execução',
  approval: 'Aguardando aprovação',
  interrupted: 'Interrompida',
  failed: 'Falhou',
};

export function Md2Dashboard({
  tasks,
  busy,
  pending,
  onOpen,
}: {
  tasks: Task[];
  busy: boolean;
  pending: number;
  onOpen: () => void;
}) {
  const [view, setView] = useState('Escritório');
  const now = new Date();
  function select(name: string) {
    setView(name);
    if (name === 'Aprovações' || name === 'Projetos') onOpen();
  }
  return (
    <div className="md2-shell" lang="pt-BR" translate="no">
      <nav className="md2-sidebar" aria-label="Navegação do escritório">
        <div className="md2-brand">
          MD2<strong>IA OFFICE</strong>
        </div>
        <p>
          Seu escritório virtual.
          <br />
          20 posições planejadas,
          <br />
          execução sob seu controle.
        </p>
        {[
          'Escritório',
          'Agentes',
          'Projetos',
          'Aprovações',
          'Clientes',
          'Relatórios',
          'Configurações',
        ].map((name, index) => (
          <button
            key={name}
            className={view === name ? 'selected' : ''}
            onClick={() => select(name)}
          >
            <span aria-hidden="true">{['⌂', '♙', '▤', '☑', '♧', '▥', '⚙'][index]}</span>
            {name}
            {name === 'Aprovações' && pending > 0 && <b className="md2-badge">{pending}</b>}
          </button>
        ))}
        <div className="md2-economy">
          <i /> Modo econômico
          <small>
            Sem agentes automáticos.
            <br />
            IA somente ao enviar uma tarefa.
          </small>
        </div>
      </nav>
      <header className="md2-topbar">
        <div>
          <strong>Seu escritório, em tempo real</strong>
          <small>
            {now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })} ·
            7 departamentos
          </small>
        </div>
        <button onClick={onOpen}>＋ Nova tarefa</button>
      </header>
      <aside className="md2-activity">
        <section>
          <h2>Projetos em andamento</h2>
          {tasks
            .filter((task) => ['running', 'approval'].includes(task.status))
            .map((task) => (
              <div className="md2-project" key={task.id}>
                <i />
                <p>
                  {task.prompt}
                  <small>{status[task.status]}</small>
                </p>
              </div>
            ))}
          {!busy && <p className="md2-muted">Nenhum projeto em execução.</p>}
        </section>
        <section>
          <h2>Atividade da equipe</h2>
          <div className="md2-project">
            <i className={busy ? 'working' : ''} />
            <p>
              Programador Codex
              <small>{busy ? 'Executando tarefa real' : 'Aguardando seu pedido'}</small>
            </p>
          </div>
          <p className="md2-muted">{busy ? '1 agente em execução' : '0 agentes em execução'}</p>
          <div className="md2-separator" />
          <h2>Departamentos</h2>
          {departments.map(([name, count, icon]) => (
            <div className="md2-department" key={name}>
              <span>
                {icon} {name}
              </span>
              <small>{count} posições</small>
            </div>
          ))}
        </section>
      </aside>
      {['Agentes', 'Clientes', 'Relatórios', 'Configurações'].includes(view) && (
        <section className="md2-info" aria-label={view}>
          <button className="md2-close" onClick={() => setView('Escritório')} aria-label="Fechar">
            ×
          </button>
          <h2>{view}</h2>
          {view === 'Agentes' ? (
            <>
              <p>
                20 posições distribuídas em sete departamentos. Os personagens representam apenas
                sessões reais.
              </p>
              {departments.map(([name, count]) => (
                <p key={name}>
                  {name} · {count} posições planejadas
                </p>
              ))}
            </>
          ) : view === 'Clientes' ? (
            <p>
              O cadastro de clientes será integrado em uma próxima etapa. Nenhum cliente fictício
              foi adicionado.
            </p>
          ) : view === 'Relatórios' ? (
            <>
              <p>
                {tasks.length} tarefas no histórico ·{' '}
                {tasks.filter((task) => task.status === 'completed').length} concluídas.
              </p>
              <p>Nenhuma porcentagem de progresso é estimada ou inventada.</p>
            </>
          ) : (
            <>
              <p>
                Modo econômico ativo: nenhuma tarefa é iniciada automaticamente. As atualizações
                visuais não chamam modelos de IA.
              </p>
              <p>
                O consumo da sua conta não é medido por este painel. Use “Cancelar tarefa” para
                encerrar uma execução.
              </p>
            </>
          )}
        </section>
      )}
      <section className="md2-bottom">
        <h2>
          Como um pedido vira entrega{' '}
          <small>Fluxo de referência · departamentos adicionais ainda planejados</small>
        </h2>
        <div className="md2-storyboard">
          {steps.map(([title, icon, description], index) => (
            <article key={title}>
              <h3>
                <b>{index + 1}</b>
                {title}
              </h3>
              <div className={`md2-scene md2-scene-${index}`} aria-hidden="true">
                <span>{icon}</span>
                <div className="md2-mini-desk" />
              </div>
              <p>{description}</p>
            </article>
          ))}
        </div>
        <div className="md2-recent">
          <strong>Projetos recentes</strong>
          {tasks.slice(0, 3).map((task) => (
            <button onClick={onOpen} key={task.id}>
              <span>▤</span>
              <p>
                {task.prompt}
                <small>{status[task.status] ?? task.status}</small>
              </p>
            </button>
          ))}
          {!tasks.length && <p>Nenhuma tarefa criada. Seu próximo projeto começa com um pedido.</p>}
          <button onClick={onOpen}>Ver tarefas →</button>
        </div>
      </section>
    </div>
  );
}
