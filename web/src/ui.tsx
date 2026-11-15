import type { ReactNode } from 'react';
import { useEffect } from 'react';

const PATHS: Record<string, string> = {
  command: 'M4 5h16v11H9l-5 4z',
  executions: 'M4 6h16M4 12h10M4 18h13M18 10l3 2-3 2',
  team: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.7-5 6-5s6 2 6 5M17 11a2.5 2.5 0 1 0 0-5M17 14c2.4.3 4 2 4 5',
  knowledge: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
  tools: 'M14 6a4 4 0 0 0-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5l-2.5 2.5-2-2z',
  deliverables: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  history: 'M4 12a8 8 0 1 0 2.5-5.8M4 5v4h4M12 8v4l3 2',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.500 4 8l-1 3 2 1v2l-2 1 1 3 2-.5L7.500 19l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.500-1.500 2 .5 1-3-2-1z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  send: 'M12 19V5M6 11l6-6 6 6',
  mic: 'M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3',
  clip: 'M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.500 3.500 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  chevron: 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 5h5v5M19 5l-8 8M11 7H6v11h11v-5',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  video: 'M4 6h11v12H4zM15 10l5-3v10l-5-3',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9h.01',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.500 3 2.500 15 0 18M12 3c-2.500 3-2.500 15 0 18',
  shield: 'M12 3l7 3v5c0 4.500-3 8-7 10-4-2-7-5.500-7-10V6z',
  logout: 'M10 5H5v14h5M14 8l4 4-4 4M18 12H9',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  alfred: 'M5 20V8l7 8 7-8v12',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}

export const STATUS: Record<string, { label: string; tone: string }> = {
  recebido: { label: 'Recebido', tone: 'blue' }, analisando: { label: 'Analisando', tone: 'gold' }, planejando: { label: 'Planejando', tone: 'gold' },
  delegado: { label: 'Delegado', tone: 'gold' }, executando: { label: 'Executando', tone: 'gold' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', tone: 'amber' }, validando: { label: 'Validando', tone: 'gold' },
  concluido: { label: 'Concluído', tone: 'green' }, falhou: { label: 'Falhou', tone: 'red' }, cancelado: { label: 'Cancelado', tone: '' },
  pendente: { label: 'Na fila', tone: '' }, concluida: { label: 'Concluída', tone: 'green' }, cancelada: { label: 'Cancelada', tone: '' },
  para_revisao: { label: 'Para revisão', tone: 'amber' }, aprovado: { label: 'Aprovado', tone: 'green' }, ajustes_solicitados: { label: 'Ajustes solicitados', tone: 'blue' },
  rejeitado: { label: 'Rejeitado', tone: 'red' }, disponivel: { label: 'Disponível', tone: 'green' }, indisponivel: { label: 'Indisponível', tone: 'red' },
};
export const Badge = ({ status, children }: { status?: string; children?: ReactNode }) => {
  const s = status ? STATUS[status] : undefined;
  return <span className={`badge ${s?.tone ?? ''}`}>{children ?? s?.label ?? status}</span>;
};
export const ACTIVE = ['recebido', 'analisando', 'planejando', 'delegado', 'executando', 'validando'];
export const PIPELINE = ['recebido', 'analisando', 'planejando', 'delegado', 'executando', 'validando', 'concluido'];

export const initials = (name: string) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
export const Avatar = ({ name, gold, sm }: { name: string; gold?: boolean; sm?: boolean }) => (
  <span className={`avatar ${gold ? 'gold' : ''} ${sm ? 'sm' : ''}`} title={name}>{gold ? <Icon name="alfred" size={sm ? 12 : 15} /> : initials(name)}</span>
);

export const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const bytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const usd = (n: number) => `US$ ${n.toFixed(2)}`;

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="grow truncate" style={{ fontWeight: 600 }}>{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty"><h3>{title}</h3><div>{children}</div></div>
);
export const Loading = ({ rows = 3, h = 72 }: { rows?: number; h?: number }) => (
  <div className="col">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: h }} />)}</div>
);

// ---- Markdown seguro (gera nós React; nunca injeta HTML) ----
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*([^*]+)\*)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>);
    else if (m[6]) out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer noopener">{m[6]}</a>);
    else if (m[9]) out.push(<em key={k}>{m[9]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      blocks.push(<pre key={k}><code>{code.join('\n')}</code></pre>);
    } else if (/^#{1,4}\s/.test(line)) { blocks.push(<h3 key={k}>{inline(line.replace(/^#+\s/, ''), k)}</h3>); i++; }
    else if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={k} />); i++; }
    else if (/^\s*([-*•]|\d+[.)])\s/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const indent = (l: string) => /^\s*/.exec(l)![0].length;
      const base = indent(line);
      const items: Array<{ key: number; text: string; sub: Array<{ key: number; text: string }> }> = [];
      for (; i < lines.length && /^\s*([-*•]|\d+[.)])\s/.test(lines[i]); i++) {
        const text = lines[i].replace(/^\s*([-*•]|\d+[.)])\s/, '');
        if (indent(lines[i]) > base && items.length) items[items.length - 1].sub.push({ key: i, text });
        else items.push({ key: i, text, sub: [] });
      }
      const lis = items.map((it) => (
        <li key={it.key}>{inline(it.text, `${k}-${it.key}`)}{it.sub.length > 0 && <ul>{it.sub.map((s) => <li key={s.key}>{inline(s.text, `${k}-${s.key}`)}</li>)}</ul>}</li>
      ));
      blocks.push(ordered ? <ol key={k}>{lis}</ol> : <ul key={k}>{lis}</ul>);
    } else if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      blocks.push(<table key={k}><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `${k}h${j}`)}</th>)}</tr></thead>
        <tbody>{rows.map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j}>{inline(c, `${k}${a}${j}`)}</td>)}</tr>)}</tbody></table>);
    } else {
      const para: string[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s)/.test(lines[i]); i++) para.push(lines[i]);
      blocks.push(<p key={k}>{para.flatMap((p, j) => [...inline(p, `${k}-${j}`), j < para.length - 1 ? <br key={`br${j}`} /> : null])}</p>);
    }
  }
  return <div className="md">{blocks}</div>;
}
