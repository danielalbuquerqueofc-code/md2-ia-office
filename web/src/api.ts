import { useEffect, useRef, useState } from 'react';

export interface Execution {
  id: string; conversation_id: string; request: string; status: string; objective: string | null; summary: string | null;
  error: string | null; cost_usd: number; created_at: string; updated_at: string; finished_at: string | null;
  conversation_title?: string; task_count?: number; task_done?: number;
}
export interface Task {
  id: string; execution_id: string; key: string; agent_id: string; title: string; instructions: string; depends_on: string;
  skills: string; status: string; attempt: number; result: string | null; error: string | null; cost_usd: number;
}
export interface LiveEvent { id: number; execution_id: string | null; task_id: string | null; agent_id: string | null; type: string; message: string; data: string | null; created_at: string }
export interface Version { version: number; entry: string; kind: string; size: number; created_at: string; url: string; agent_id: string }
export interface Deliverable {
  id: string; conversation_id: string; execution_id: string | null; agent_id: string | null; name: string; category: string;
  client: string | null; status: string; notes: string | null; decision_note: string | null; created_at: string; updated_at: string; versions: Version[];
}
export interface Approval {
  id: string; execution_id: string | null; agent_id: string | null; type: string; title: string; description: string;
  payload: string | null; status: string; outcome: string | null; decision_note: string | null; created_at: string; decided_at: string | null;
}
export interface Agent {
  id: string; name: string; department: string; departmentName: string; role: string; specialty: string; capabilities: string[];
  instructions: string[]; limits: string[]; quality: string[]; skills: string[]; knowledge: string[]; provisionalName?: boolean;
  tools: Array<{ id: string; name: string; status: string }>; currentTask: { title: string; execution_id: string } | null; completedTasks: number;
}
export interface Message { id: string; role: 'user' | 'assistant'; content: string; attachments: Array<{ id: string; name: string }>; execution_id: string | null; created_at: string }
export interface ExecutionDetail { execution: Execution; tasks: Task[]; events: LiveEvent[]; deliverables: Deliverable[]; approvals: Approval[] }
export interface AppState {
  runtime: { ready: boolean; detail: string };
  counts: { running: number; approvals: number; review: number };
  costToday: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const authListeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => { authListeners.add(fn); return () => { authListeners.delete(fn); }; };

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-md2': '1' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) authListeners.forEach((f) => f());
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export async function upload(file: File): Promise<{ id: string; name: string; size: number }> {
  const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'x-md2': '1' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Falha no envio do arquivo.');
  return data;
}

// ---- tempo real (SSE) ----
type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connected = false;
const connListeners = new Set<(c: boolean) => void>();
const setConnected = (c: boolean) => { connected = c; connListeners.forEach((f) => f(c)); };

export function connectStream() {
  if (source) return;
  source = new EventSource('/api/stream');
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
  source.onmessage = (m) => { const e = JSON.parse(m.data) as LiveEvent; listeners.forEach((f) => f(e)); };
}
export function disconnectStream() { source?.close(); source = null; setConnected(false); }

export function useLiveEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => { const l: Listener = (e) => ref.current(e); listeners.add(l); return () => { listeners.delete(l); }; }, []);
}
export function useConnected() {
  const [c, setC] = useState(connected);
  useEffect(() => { connListeners.add(setC); return () => { connListeners.delete(setC); }; }, []);
  return c;
}

/** Busca dados e refaz a busca (com debounce) quando chegam eventos que casam com `when`. */
export function useData<T>(path: string | null, when: (e: LiveEvent) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const load = useRef(() => {});
  load.current = () => {
    if (!path) return;
    api<T>(path).then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
  };
  useEffect(() => { setData(null); load.current(); }, [path]);
  useLiveEvents((e) => {
    if (!when(e)) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => load.current(), 250);
  });
  return { data, error, reload: () => load.current() };
}
