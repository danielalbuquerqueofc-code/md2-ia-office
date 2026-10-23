import { useCallback, useEffect, useState } from 'react';

import { serverToken } from '../transport/serverToken.js';
import { Md2Dashboard } from './Md2Dashboard.js';
import { Md2IsometricOffice } from './Md2IsometricOffice.js';
import { Button } from './ui/Button.js';

type Task = {
  id: string;
  agentId?: number;
  threadId?: string;
  prompt: string;
  status: string;
  output: string;
  error?: string;
  events: string[];
};
type Approval = {
  id: string;
  taskId: string;
  method: string;
  details: Record<string, unknown>;
  reviewable: boolean;
  status: string;
};
type Snapshot = { tasks: Task[]; approvals: Approval[]; busy: boolean; workspace: string };
const labels: Record<string, string> = {
  running: 'Trabalhando',
  approval: 'Aguardando sua decisão',
  completed: 'Concluída',
  failed: 'Falhou',
  interrupted: 'Interrompida',
  accepted: 'Aprovada',
  declined: 'Rejeitada',
  expired: 'Expirada',
};

async function api(route: string, body?: unknown) {
  const response = await fetch(`/api/md2${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${serverToken}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível acessar o escritório.');
  return result;
}

export function Md2OfficePanel() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const refresh = useCallback(async () => {
    if (!serverToken) return;
    try {
      setSnapshot(await api('/state'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  useEffect(() => {
    void fetch('/api/md2/enabled')
      .then((response) => response.json())
      .then((result) => setEnabled(result.enabled === true))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await refresh();
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, 1200);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh, enabled]);

  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.add('md2-dashboard');
    window.dispatchEvent(new Event('md2-dashboard-ready'));
    return () => document.documentElement.classList.remove('md2-dashboard');
  }, [enabled]);

  async function act(route: string, body: unknown) {
    setSending(true);
    setError('');
    try {
      await api(route, body);
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  }
  const pending = snapshot?.approvals.filter((approval) => approval.status === 'pending') ?? [];

  if (!enabled) return null;
  return (
    <>
      <Md2IsometricOffice tasks={snapshot?.tasks ?? []} onOpen={() => setOpen(true)} />
      <Md2Dashboard
        tasks={snapshot?.tasks ?? []}
        busy={snapshot?.busy ?? false}
        pending={pending.length}
        onOpen={() => setOpen(true)}
      />
      {open && (
        <aside aria-label="MD2 IA Office" lang="pt-BR" translate="no" className="md2-task-panel">
          <div className="flex items-center justify-between gap-8">
            <strong>MD2 IA OFFICE</strong>
            <Button size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              {open ? 'Recolher' : `Abrir${pending.length ? ` · ${pending.length} decisão` : ''}`}
            </Button>
          </div>
          {open && (
            <div className="max-h-[70vh] overflow-auto mt-8 space-y-12">
              <p>Tecnologia · Programador Codex</p>
              {!serverToken ? (
                <p>Abra o endereço de operador exibido ao iniciar o escritório.</p>
              ) : (
                <>
                  <p className="text-text-muted break-all" title={snapshot?.workspace}>
                    Projeto: {snapshot?.workspace.split(/[\\/]/).pop() ?? 'Conectando…'}
                  </p>
                  {!snapshot?.busy && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act('/tasks', { prompt });
                      }}
                    >
                      <label htmlFor="md2-task">O que o programador deve fazer?</label>
                      <textarea
                        id="md2-task"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        maxLength={8000}
                        required
                        className="block w-full h-80 bg-bg border-2 border-border p-8 mt-8"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="mt-8"
                        disabled={sending || !snapshot || snapshot.busy || !prompt.trim()}
                      >
                        {snapshot?.busy ? 'Programador ocupado' : 'Executar tarefa'}
                      </Button>
                    </form>
                  )}
                  {error && (
                    <p role="alert" className="text-danger">
                      {error}
                    </p>
                  )}
                  <h2>Centro de aprovações · {pending.length} pendente(s)</h2>
                  {!pending.length && <p className="text-text-muted">Nenhuma decisão pendente.</p>}
                  {pending.map((approval) => (
                    <section key={approval.id} className="border-2 border-warning p-8 space-y-8">
                      <p>
                        {approval.method.includes('fileChange')
                          ? 'Alterar arquivos'
                          : 'Executar comando'}
                      </p>
                      {approval.method.includes('fileChange') ? (
                        Array.isArray(approval.details.changes) ? (
                          approval.details.changes.map((change: { path: string; diff: string }) => (
                            <div key={change.path} className="space-y-8">
                              <p className="break-all">
                                {change.path.startsWith(snapshot?.workspace ?? '')
                                  ? change.path.slice((snapshot?.workspace.length ?? 0) + 1)
                                  : change.path}
                              </p>
                              <pre className="whitespace-pre-wrap break-words text-xs max-h-160 overflow-auto">
                                {change.diff}
                              </pre>
                            </div>
                          ))
                        ) : (
                          <p>Prévia indisponível. Rejeite este pedido.</p>
                        )
                      ) : (
                        <pre className="whitespace-pre-wrap break-all text-xs max-h-160 overflow-auto">
                          {String(
                            approval.details.command ??
                              'Comando indisponível. Rejeite este pedido.',
                          )}
                        </pre>
                      )}
                      <div className="flex gap-8">
                        <Button
                          size="sm"
                          disabled={sending || !approval.reviewable}
                          onClick={() =>
                            void act(`/approvals/${approval.id}`, { decision: 'accept' })
                          }
                        >
                          Aprovar esta ação
                        </Button>
                        <Button
                          size="sm"
                          disabled={sending}
                          onClick={() =>
                            void act(`/approvals/${approval.id}`, { decision: 'decline' })
                          }
                        >
                          Rejeitar
                        </Button>
                      </div>
                      <p className="text-text-muted">
                        Expira em até dois minutos. A decisão vale apenas para este pedido.
                      </p>
                    </section>
                  ))}
                  <h2>Tarefas</h2>
                  {!snapshot?.tasks.length && (
                    <p className="text-text-muted">Nenhuma tarefa executada.</p>
                  )}
                  {snapshot?.tasks.map((task) => (
                    <section key={task.id} className="border-t-2 border-border pt-8 space-y-8">
                      <p className="break-words">{task.prompt}</p>
                      <strong>{labels[task.status] ?? task.status}</strong>
                      {['running', 'approval'].includes(task.status) && (
                        <Button
                          size="sm"
                          disabled={sending}
                          onClick={() => void act(`/tasks/${task.id}/cancel`, {})}
                        >
                          Cancelar tarefa
                        </Button>
                      )}
                      {task.error && (
                        <p role="alert" className="text-danger break-words">
                          {task.error}
                        </p>
                      )}
                      {task.output && (
                        <pre className="whitespace-pre-wrap break-words max-h-160 overflow-auto">
                          {task.output}
                        </pre>
                      )}
                      <details>
                        <summary>Eventos reais</summary>
                        {task.events.map((name, index) => (
                          <p key={`${name}-${index}`}>{name}</p>
                        ))}
                      </details>
                    </section>
                  ))}
                  <details>
                    <summary>Histórico de decisões</summary>
                    {snapshot?.approvals
                      .filter((approval) => approval.status !== 'pending')
                      .slice(0, 20)
                      .map((approval) => (
                        <p key={approval.id}>
                          {labels[approval.status]} · {approval.method}
                        </p>
                      ))}
                  </details>
                </>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  );
}
