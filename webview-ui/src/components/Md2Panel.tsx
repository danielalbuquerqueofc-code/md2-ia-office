import { useEffect, useState } from 'react';

import { MD2_PANEL_COLORS } from '../constants.js';

type Task = { id: string; status: string };
export function Md2Panel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    const receive = (message: MessageEvent) => {
      if (message.data?.type !== 'md2Event') return;
      const event = message.data.event;
      const method = String(event.method || '');
      setEvents((previous) => [method, ...previous].slice(0, 8));
      const turn = event.params?.turn;
      if (turn?.id && (method === 'turn/started' || method === 'turn/completed')) {
        setTasks((previous) =>
          [
            {
              id: turn.id,
              status: method === 'turn/started' ? 'Em execução' : String(turn.status),
            },
            ...previous.filter((task) => task.id !== turn.id),
          ].slice(0, 20),
        );
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  return (
    <aside
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 30,
        background: MD2_PANEL_COLORS.background,
        color: MD2_PANEL_COLORS.text,
        padding: 14,
        width: 270,
        maxHeight: '65%',
        overflow: 'auto',
        border: `2px solid ${MD2_PANEL_COLORS.border}`,
        fontSize: 12,
      }}
    >
      <strong>MD2 IA OFFICE · Tecnologia</strong>
      <p>Programador Codex · eventos reais</p>
      <p>Selecione Codex em + Agent e envie a tarefa no terminal.</p>
      <h3>Tarefas desta sessão</h3>
      {tasks.length === 0 ? (
        <p>Aguardando uma tarefa real.</p>
      ) : (
        tasks.map((task) => (
          <p key={task.id}>
            {task.id.slice(0, 12)} · {task.status}
          </p>
        ))
      )}
      <h3>Centro de aprovações</h3>
      <p>
        Pedidos abrem uma confirmação no VS Code. Fechar ou perder conexão rejeita a ação.
        Permissões adicionais são negadas.
      </p>
      <h3>Últimos eventos</h3>
      {events.map((event, index) => (
        <div key={index}>{event}</div>
      ))}
    </aside>
  );
}
