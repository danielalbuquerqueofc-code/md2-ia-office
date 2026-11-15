import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Agent, AppState, Execution, Message } from '../api';
import { api, upload, useData } from '../api';
import { go } from '../App';
import { ExecutionCard } from '../components/ExecutionCard';
import { ACTIVE, Avatar, Icon, Markdown, time } from '../ui';

interface Conversation { conversation: { id: string; title: string }; messages: Message[]; executions: Execution[] }
const SUGGESTIONS = [
  { t: 'Criar um site profissional', d: 'Analise a empresa pelo Google e Instagram e construa o site.', p: 'Alfred, crie um site profissional para esta empresa. Analise o Google e o Instagram. Links: ' },
  { t: 'Produzir um Reels', d: 'Envie vídeos e fotos e receba um vídeo vertical editado.', p: 'Alfred, analise os vídeos e fotos anexados e produza um Reels de 30 segundos sobre ' },
  { t: 'Montar uma proposta comercial', d: 'Escopo, investimento e condições em documento pronto.', p: 'Alfred, prepare uma proposta comercial para ' },
  { t: 'Planejar uma campanha', d: 'Estrutura de Meta Ads com públicos, criativos e orçamento.', p: 'Alfred, planeje uma campanha de Meta Ads para ' },
];
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: () => void };

export function Command({ conversationId, agents, runtime }: { conversationId?: string; agents: Agent[]; runtime?: AppState['runtime'] }) {
  const { data, reload } = useData<Conversation>(conversationId ? `/api/conversations/${conversationId}` : null, (e) => e.type === 'mensagem' || e.type === 'status');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<Array<{ id: string; name: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [recording, setRecording] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const SpeechCtor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;

  useLayoutEffect(() => { const a = area.current; if (a) { a.style.height = 'auto'; a.style.height = `${Math.min(a.scrollHeight, 220)}px`; } }, [text]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [data?.messages.length, conversationId]);
  useEffect(() => { area.current?.focus(); }, [conversationId]);
  useEffect(() => () => recognition.current?.stop(), []);

  const addFiles = async (list: FileList | File[]) => {
    setError('');
    for (const f of Array.from(list)) {
      setUploading((n) => n + 1);
      try { const up = await upload(f); setFiles((x) => [...x, { id: up.id, name: up.name }]); }
      catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
      finally { setUploading((n) => n - 1); }
    }
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending || uploading) return;
    setSending(true); setError('');
    try {
      const r = await api<{ conversationId: string }>('/api/messages', { conversationId, text: body, attachments: files, clientRequestId: crypto.randomUUID() });
      setText(''); setFiles([]);
      if (r.conversationId !== conversationId) go(`comando/${r.conversationId}`); else reload();
    } catch (e) { setError((e as Error).message); } finally { setSending(false); }
  };
  const toggleVoice = () => {
    if (recording) return recognition.current?.stop();
    if (!SpeechCtor) return;
    const r = new SpeechCtor();
    const base = text ? `${text.trimEnd()} ` : '';
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; setText(base + t); };
    r.onend = () => setRecording(false);
    r.onerror = () => { setRecording(false); setError('Não foi possível usar o microfone. Verifique a permissão do navegador.'); };
    recognition.current = r; r.start(); setRecording(true);
  };

  const messages = data?.messages ?? [];
  const busy = data?.executions.some((x) => ACTIVE.includes(x.status));
  const shown = new Set<string>();

  return (
    <div className="cc">
      <div className="cc-scroll" ref={scroller}>
        {!conversationId ? (
          <div className="welcome">
            <div className="alfred-mark"><Icon name="alfred" size={26} /></div>
            <h2>O que vamos executar hoje?</h2>
            <p>Dê a ordem. Alfred planeja, distribui para a equipe de 22 agentes, acompanha a execução e traz a entrega para você aprovar.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s.t} className="suggestion" onClick={() => { setText(s.p); area.current?.focus(); }}><b>{s.t}</b><span>{s.d}</span></button>)}
            </div>
          </div>
        ) : (
          <div className="cc-thread">
            {!data && <div className="skeleton" style={{ height: 120 }} />}
            {messages.map((m) => {
              const firstOfExec = m.role === 'user' && m.execution_id && !shown.has(m.execution_id);
              if (firstOfExec) shown.add(m.execution_id!);
              return (
                <div key={m.id} className="col" style={{ gap: 14 }}>
                  {m.role === 'user' ? (
                    <div className="msg user">
                      <div className="col" style={{ alignItems: 'flex-end', gap: 6, maxWidth: '100%' }}>
                        <div className="bubble">{m.content}</div>
                        {m.attachments.length > 0 && <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{m.attachments.map((a) => <span key={a.id} className="attach"><Icon name="clip" size={12} /><span className="truncate">{a.name}</span></span>)}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="msg">
                      <Avatar name="Alfred" gold />
                      <div className="body"><div className="who">Alfred<span>{time(m.created_at)}</span></div><Markdown text={m.content} /></div>
                    </div>
                  )}
                  {firstOfExec && <ExecutionCard executionId={m.execution_id!} agents={agents} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="composer-wrap">
        {runtime && !runtime.ready && <div className="banner err" style={{ maxWidth: 860, margin: '0 auto 10px' }}><Icon name="shield" /> <span><b>Runtime dos agentes indisponível.</b> {runtime.detail} Enquanto isso, nenhuma tarefa é executada.</span></div>}
        {error && <div className="banner err" style={{ maxWidth: 860, margin: '0 auto 10px' }}>{error}</div>}
        <div className={`composer ${drag ? 'drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void addFiles(e.dataTransfer.files); }}>
          {(files.length > 0 || uploading > 0) && (
            <div className="composer-files">
              {files.map((f) => <span key={f.id} className="attach"><Icon name="clip" size={12} /><span className="truncate">{f.name}</span><button onClick={() => setFiles((x) => x.filter((y) => y.id !== f.id))} aria-label={`Remover ${f.name}`}><Icon name="x" size={12} /></button></span>)}
              {uploading > 0 && <span className="attach"><span className="spinner" /> Enviando…</span>}
            </div>
          )}
          <textarea ref={area} rows={1} value={text} placeholder="Alfred, o que vamos executar hoje?" aria-label="Mensagem para Alfred"
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void addFiles(e.clipboardData.files); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
          <div className="composer-bar">
            <input ref={picker} type="file" multiple hidden accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx,.zip" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
            <button className="icon-btn" onClick={() => picker.current?.click()} title="Anexar arquivos, imagens ou vídeos" aria-label="Anexar arquivos"><Icon name="clip" /></button>
            <button className={`icon-btn ${recording ? 'rec' : ''}`} onClick={toggleVoice} disabled={!SpeechCtor} aria-pressed={recording}
              title={SpeechCtor ? (recording ? 'Parar ditado' : 'Falar com Alfred') : 'Ditado por voz não é suportado neste navegador (use Chrome ou Edge)'} aria-label="Entrada por voz"><Icon name="mic" /></button>
            {conversationId && <button className="btn ghost sm" onClick={() => go('comando')}><Icon name="plus" size={14} /> Nova conversa</button>}
            <span className="grow" />
            {busy && <span className="xs dim row" style={{ marginRight: 6 }}><span className="spinner" /> equipe trabalhando</span>}
            <button className="send" onClick={send} disabled={!text.trim() || sending || uploading > 0} aria-label="Enviar"><Icon name="send" /></button>
          </div>
        </div>
        <div className="composer-hint">Enter envia · Shift+Enter quebra linha · Arraste arquivos para anexar · Nada é publicado sem a sua aprovação</div>
      </div>
    </div>
  );
}
