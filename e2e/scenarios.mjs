// Cenários de validação real. O pedido é montado SOMENTE com o que o usuário informar: nada é inventado sobre o cliente.
import path from 'node:path';

export const SCENARIOS = {
  a: {
    nome: 'Criação de site profissional a partir de Google Maps e Instagram',
    prompt({ maps, instagram, site, briefing, anexos = [] }) {
      const partes = ['Alfred, crie um site profissional para esta empresa. Analise o Google e o Instagram, identifique as oportunidades comerciais, defina o posicionamento e entregue o site testado. Quero um projeto com qualidade comercial de pelo menos R$ 2.000.'];
      if (maps) partes.push(`Google Maps: ${maps}`);
      if (instagram) partes.push(`Instagram: ${instagram}`);
      if (site) partes.push(`Site atual: ${site}`);
      if (anexos.length) partes.push(`Arquivos anexados: ${anexos.map((a) => path.basename(a)).join(', ')}.`);
      if (briefing) partes.push(`Informações fornecidas por mim: ${briefing}`);
      return partes.join('\n');
    },
    exige: { agentes: ['sofia', 'andre'], tarefasConcluidas: ['sofia'], entregaveis: ['site'] },
  },
  b: {
    nome: 'Reels de 30 segundos a partir de pasta autorizada com vídeos reais',
    prompt({ pasta, tema, duracao = 30 }) {
      return `Alfred, encontre a pasta ${path.basename(pasta)} no meu notebook. Analise os vídeos e fotografias, produza um Reels de ${duracao} segundos sobre ${tema}, gere a legenda e apresente a prévia.`;
    },
    exige: { agentes: ['diego', 'isabela', 'sofia'], tarefasConcluidas: ['diego', 'isabela', 'sofia'], entregaveis: ['video'] },
  },
};

/**
 * Classificação honesta do resultado. "VALIDADO" exige TODAS as condições; qualquer falha vira "NÃO VALIDADO" com o motivo.
 * Cenário B só valida com material que o usuário atesta ser real E que o preflight não aponta como sintético.
 */
export function classify({ cenario, execStatus, independentChecks, sandboxActive, tasks, deliverables, materialAtestado, preflight, avisos = [] }) {
  const motivos = [];
  const exige = SCENARIOS[cenario].exige;
  if (!['concluido', 'aguardando_aprovacao'].includes(execStatus)) motivos.push(`execução terminou como "${execStatus}"`);
  if (!sandboxActive) motivos.push('o isolamento (sandbox) não estava ativo');
  for (const ag of exige.agentes) if (!tasks.some((t) => t.agent_id === ag)) motivos.push(`Alfred não acionou ${ag}`);
  for (const ag of exige.tarefasConcluidas) if (!tasks.some((t) => t.agent_id === ag && t.status === 'concluida')) motivos.push(`a tarefa de ${ag} não foi concluída`);
  for (const k of exige.entregaveis) if (!deliverables.some((d) => d.versions?.[0]?.kind === k || d.category === k)) motivos.push(`nenhum entregável do tipo ${k}`);
  const falhas = independentChecks.filter((c) => !c.ok);
  for (const f of falhas) motivos.push(`verificação independente falhou: ${f.nome} (${f.detalhe})`);
  if (cenario === 'b') {
    if (!materialAtestado) motivos.push('o usuário não atestou que o material é real (--material-real)');
    if (preflight?.suspectedSynthetic) motivos.push('o preflight indica material sintético ou de teste: não vale como validação do cenário B');
  }
  if (motivos.length) return { nivel: 'NAO_VALIDADO', motivos, avisos };
  const ressalvas = [...avisos];
  if (cenario === 'b' && preflight?.cameraEvidence === 0) ressalvas.push('os vídeos não têm metadados de câmera (comum em vídeos exportados ou recomprimidos); a natureza real do material repousa na sua declaração');
  return { nivel: ressalvas.length ? 'VALIDADO_COM_RESSALVAS' : 'VALIDADO', motivos: [], avisos: ressalvas };
}
