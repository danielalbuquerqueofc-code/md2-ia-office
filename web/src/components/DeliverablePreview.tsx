import { useEffect, useState } from 'react';
import type { Deliverable } from '../api';
import { api } from '../api';
import { Badge, bytes, dateTime, Icon, Modal } from '../ui';

export const KIND_ICON: Record<string, string> = { site: 'globe', pagina: 'globe', video: 'video', imagem: 'image', pdf: 'file', texto: 'file', audio: 'file', arquivo: 'file' };
export const CATEGORY_LABEL: Record<string, string> = {
  site: 'Sites', video: 'Vídeos', imagem: 'Imagens', documento: 'Documentos', proposta: 'Propostas', relatorio: 'Relatórios', campanha: 'Campanhas', projeto: 'Projetos', outro: 'Outros arquivos',
};
const DEVICES = [{ id: 'desktop', label: 'Desktop', w: '100%' }, { id: 'tablet', label: 'Tablet', w: '768px' }, { id: 'mobile', label: 'Celular', w: '390px' }];

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState('Carregando…');
  useEffect(() => { fetch(url).then((r) => r.text()).then((t) => setText(t.slice(0, 200_000))).catch(() => setText('Não foi possível carregar o arquivo.')); }, [url]);
  return <pre className="mono">{text}</pre>;
}

/** Prévia real do entregável. Sites e páginas rodam em iframe isolado (sandbox, sem acesso à sessão). */
export function DeliverablePreview({ deliverable: d, agentName, onClose, onChanged }: { deliverable: Deliverable; agentName?: string; onClose: () => void; onChanged: () => void }) {
  const [version, setVersion] = useState(d.versions[0]);
  const [device, setDevice] = useState(DEVICES[0]);
  const [adjust, setAdjust] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isPage = version.kind === 'site' || version.kind === 'pagina';

  const decide = async (decision: 'aprovar' | 'ajustar') => {
    setBusy(true); setError('');
    try { await api(`/api/deliverables/${d.id}/decision`, { decision, note: note || undefined }); onChanged(); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Modal wide onClose={onClose} title={<span className="row"><Icon name={KIND_ICON[version.kind] ?? 'file'} /> <span className="truncate">{d.name}</span> <Badge status={d.status} /></span>}>
      <div className="preview-wrap">
        <div className="preview">
          {isPage ? <div className="device" style={{ width: device.w }}><iframe key={version.url} src={version.url} title={d.name} sandbox="allow-scripts allow-forms allow-popups" /></div>
            : version.kind === 'video' ? <video key={version.url} src={version.url} controls playsInline />
            : version.kind === 'imagem' ? <img src={version.url} alt={d.name} />
            : version.kind === 'audio' ? <audio src={version.url} controls />
            : version.kind === 'pdf' ? <iframe src={version.url} title={d.name} />
            : version.kind === 'texto' ? <TextPreview url={version.url} />
            : <div className="col" style={{ alignItems: 'center' }}><Icon name="file" size={36} /><span className="muted">Sem prévia para este tipo de arquivo.</span></div>}
        </div>
        <aside className="preview-side">
          {isPage && <div className="tabs">{DEVICES.map((x) => <button key={x.id} className={`tab ${device.id === x.id ? 'active' : ''}`} onClick={() => setDevice(x)}>{x.label}</button>)}</div>}
          <dl className="kv">
            <dt>Cliente</dt><dd>{d.client ?? '—'}</dd>
            <dt>Categoria</dt><dd>{CATEGORY_LABEL[d.category] ?? d.category}</dd>
            <dt>Responsável</dt><dd>{agentName ?? d.agent_id ?? '—'}</dd>
            <dt>Atualizado</dt><dd>{dateTime(d.updated_at)}</dd>
            <dt>Tamanho</dt><dd>{bytes(version.size)}</dd>
          </dl>
          {d.notes && <div><div className="label">Observações</div><p className="small muted" style={{ marginTop: 4 }}>{d.notes}</p></div>}
          {d.decision_note && <div><div className="label">Sua última decisão</div><p className="small muted" style={{ marginTop: 4 }}>{d.decision_note}</p></div>}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Histórico de versões</div>
            <div className="col" style={{ gap: 4 }}>
              {d.versions.map((v) => (
                <button key={v.version} className={`btn sm ${v.version === version.version ? '' : 'ghost'}`} style={{ justifyContent: 'space-between' }} onClick={() => setVersion(v)}>
                  <span>Versão {v.version}</span><span className="dim xs">{dateTime(v.created_at)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a className="btn sm" href={version.url} target="_blank" rel="noreferrer noopener"><Icon name="external" size={14} /> Abrir</a>
            {!isPage && <a className="btn sm" href={`${version.url}?download`}><Icon name="download" size={14} /> Baixar</a>}
          </div>
          {adjust && <textarea className="input" autoFocus placeholder="Descreva os ajustes. Alfred abrirá uma nova execução nesta conversa." value={note} onChange={(e) => setNote(e.target.value)} />}
          {error && <div className="banner err">{error}</div>}
        </aside>
      </div>
      <div className="modal-foot">
        <span className="grow small dim">Aprovar o entregável não publica nada. Publicações passam pelo centro de aprovações.</span>
        {adjust ? (
          <>
            <button className="btn ghost" onClick={() => setAdjust(false)}>Cancelar</button>
            <button className="btn primary" disabled={busy || !note.trim()} onClick={() => decide('ajustar')}>Enviar ajustes ao Alfred</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setAdjust(true)}>Solicitar ajustes</button>
            <button className="btn primary" disabled={busy || d.status === 'aprovado'} onClick={() => decide('aprovar')}><Icon name="check" size={15} /> {d.status === 'aprovado' ? 'Aprovado' : 'Aprovar'}</button>
          </>
        )}
      </div>
    </Modal>
  );
}
