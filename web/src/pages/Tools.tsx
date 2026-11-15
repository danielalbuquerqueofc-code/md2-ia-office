import { useData } from '../api';
import { Badge, Loading } from '../ui';

interface Tool { id: string; name: string; category: string; description: string; sdkTools: string[]; gatedActions: string[]; status: string; detail: string; howToEnable?: string; classification: string; evidence: string }
const CLASS: Record<string, { label: string; tone: string }> = {
  funcional_testada: { label: 'Funcional e testada', tone: 'concluido' },
  configurada_nao_testada: { label: 'Configurada, não testada', tone: 'para_revisao' },
  parcial: { label: 'Parcialmente implementada', tone: 'para_revisao' },
  nao_implementada: { label: 'Não implementada', tone: 'cancelado' },
  aguardando_credenciais: { label: 'Aguardando credenciais', tone: 'para_revisao' },
};

export function Tools() {
  const { data } = useData<Tool[]>('/api/tools', () => false);
  const cats = [...new Set(data?.map((t) => t.category))];
  return (
    <div className="page">
      <div className="page-head"><div><h1>Ferramentas</h1><p>Registro central do que os agentes podem usar. O status é detectado no ambiente real: integrações sem credenciais ou sem conector aparecem como pendentes e não são usadas.</p></div>
        <div className="spacer" />{data && <Badge status="disponivel">{data.filter((t) => t.status === 'disponivel').length} de {data.length} ativas</Badge>}</div>
      {!data ? <Loading /> : cats.map((c) => (
        <section key={c} style={{ marginBottom: 24 }}>
          <div className="label" style={{ marginBottom: 10 }}>{c}</div>
          <div className="grid c3">{data.filter((t) => t.category === c).map((t) => (
            <div key={t.id} className="card pad col">
              <div className="row"><b className="grow" style={{ fontWeight: 600 }}>{t.name}</b><Badge status={t.status === 'pendente' ? 'para_revisao' : t.status}>{t.status === 'pendente' ? 'Pendente' : undefined}</Badge></div>
              <p className="small muted">{t.description}</p>
              <div className="row" style={{ flexWrap: 'wrap' }}><Badge status={CLASS[t.classification]?.tone}>{CLASS[t.classification]?.label ?? t.classification}</Badge></div>
              <p className="small">{t.detail}</p>
              <p className="xs dim"><b>Evidência:</b> {t.evidence}</p>
              {t.howToEnable && <div className="banner"><span><b>Como ativar:</b> {t.howToEnable}</span></div>}
              {t.gatedActions.length > 0 && <div><div className="label" style={{ marginBottom: 6 }}>Exige aprovação humana</div><div className="tags">{t.gatedActions.map((g) => <span key={g} className="tag">{g}</span>)}</div></div>}
            </div>
          ))}</div>
        </section>
      ))}
    </div>
  );
}
