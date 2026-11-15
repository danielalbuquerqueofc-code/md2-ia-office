/**
 * Prévia do plano do Alfred: mostra quem ele escolheria, em que ordem, com quais entregas e critérios, SEM executar
 * nada. Custa uma ou duas chamadas ao Alfred (~US$ 0,10–0,40), somadas ao gasto do dia.
 * Uso: npm run plan:preview -- "pedido em linguagem natural"
 */
import { bootstrap } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { ClaudeAgentRuntime } from '../src/runtime/claudeRuntime.js';

const text = process.argv.slice(2).join(' ').trim();
if (!text) throw new Error('Uso: npm run plan:preview -- "pedido"');
const config = loadConfig();
const { services, engine } = bootstrap(config, new ClaudeAgentRuntime(config));
try {
  const { plan, errors, costUsd } = await engine.previewPlan({ text });
  const name = (id: string) => services.agents.get(id)?.name ?? id;
  console.log(`\nObjetivo: ${plan.objetivo}\nModo: ${plan.modo}\n${plan.resposta}\n`);
  for (const t of plan.tarefas) {
    console.log(`[${t.chave}] ${name(t.agente)} (${t.agente}) — ${t.titulo}`);
    console.log(`   depende de: ${t.depende_de.join(', ') || '—'} | skills: ${t.skills.join(', ') || '—'} | entrega: ${t.entrega_esperada || '(texto)'}`);
    for (const c of t.criterios_de_aceite) console.log(`   · ${c}`);
  }
  const par = plan.tarefas.filter((t) => !t.depende_de.length).map((t) => t.chave);
  console.log(`\nComeçam em paralelo: ${par.join(', ') || '—'}`);
  console.log(`Validação do plano: ${errors.length ? `REJEITADO — ${errors.join('; ')}` : 'aprovada'}`);
  console.log(`Custo desta prévia: US$ ${costUsd.toFixed(3)}`);
} finally {
  services.db.close();
}
