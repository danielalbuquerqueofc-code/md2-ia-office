# Alfred, o orquestrador

Alfred é o único ponto de contato do usuário. Ele **não** é um dos 22 agentes (o cadastro original não o previa; foi definido nesta reformulação). Os 22 agentes não falam com o usuário nem entre si: pedem a Alfred, que decide.

**Alfred × Carlos.** No projeto original, Carlos era a porta de entrada (recebia e classificava por regras fixas, sem IA). Hoje Alfred recebe e orquestra; Carlos continua Diretor-geral, o agente de estratégia e de parecer executivo, acionado quando o pedido exige uma decisão estratégica.

## O que Alfred faz, passo a passo

| Etapa | O que acontece | Onde está |
|---|---|---|
| Recebimento | Registra a mensagem (idempotente: reenviar não duplica), copia anexos sem sobrescrever nomes iguais | `engine.ts` `submit` |
| Contexto | Junta as últimas 10 mensagens, os entregáveis já feitos, a árvore do workspace, **os nomes reais das pastas autorizadas**, as ferramentas indisponíveis e trechos de conhecimento | `planPrompt` |
| Plano | Decide entre responder direto ou planejar. Planejando, define objetivo, tarefas, agente de cada uma, dependências, skills, **entrega esperada** e **critérios de aceite** | `alfred.ts` |
| Validação do plano | Código determinístico rejeita e devolve para refazer (até 2 vezes) | `validatePlan` |
| Delegação | Cada agente recebe só: o papel permanente, as instruções, os resultados das dependências, as skills que possui e o conhecimento do seu departamento | `runTask` |
| Execução | Tarefas independentes em paralelo; falha tem nova tentativa com sessão retomada; timeout, teto de custo, pausa quando a conta Claude chega ao limite | `runTasks` |
| Cobrança | Ao fim de cada tarefa o **sistema** confere se o arquivo esperado existe, não está vazio e foi registrado. Se não, Alfred cobra o agente uma vez, retomando a sessão | `checkOutput` |
| Validação | Alfred confere critérios de aceite, fatos medidos e consistência entre entregáveis; pode pedir **uma** rodada de correção e acionar outro especialista a pedido de um agente | `review` |
| Devolutiva | Resposta consolidada: o que foi entregue e onde, o que falhou, aprovações pendentes e próximo passo | `resposta_final` |

## Os seus requisitos, um a um

| Requisito | Situação | Evidência | Limite |
|---|---|---|---|
| Entende linguagem natural | Sim | Execuções reais (proposta, site, Reels) e 3 prévias de plano | Depende do modelo; o planejamento não é determinístico |
| Identifica o objetivo real | Sim | O plano traz `objetivo`. Numa prévia, com links de exemplo, Alfred **recusou inventar a empresa** e pediu os dados reais | Medido em poucos casos |
| Escolhe os agentes adequados | Sim | Prévia do cenário A: 9 tarefas com Lucas, Mariana, Beatriz, Isabela, Camila, Vinícius, André, Sofia e Amanda. Cenário B: Diego, Isabela, Vinícius, Diego, Sofia e Amanda. Só agentes do cadastro original, sem eu citar nomes | **Duas** prévias; não há taxa de acerto medida em amostra ampla |
| Delega sem exigir que o usuário indique cada especialista | Sim | O pedido do cenário A/B não contém nomes de agentes | — |
| Coordena dependências | Sim | Cenário A: Lucas ∥ Mariana; Isabela ∥ Camila. Testado com ciclos de qualquer tamanho e dependência indireta | — |
| Evita trabalho duplicado | **Parcialmente** | Código rejeita: duas tarefas com a mesma entrega, mesmo agente e título, skill atribuída a quem não a possui. Reenvio e ajuste duplicado não criam outra execução. Testado | Duplicidade **semântica** (títulos diferentes, mesmo trabalho) só é contida pela regra do prompt e pela validação, não por código |
| Acompanha a execução | Sim | Eventos em tempo real (SSE) persistidos, custo e etapas por tarefa, retomada após queda (testada com `SIGKILL`), pausa e retomada no limite da conta | — |
| Cobra resultados | **Parcialmente** | Arquivo ausente, vazio ou não registrado → cobrança com sessão retomada (testado). Critérios de aceite entram no prompt da tarefa e na validação | Só existência e registro são verificados por código. Os demais critérios dependem do julgamento do modelo na validação |
| Revisa entregáveis | Sim | Etapa de validação, mais as tarefas de QA (Sofia) e de aceite (Amanda) que o plano inclui. Site ou vídeo sem QA depois da construção é **rejeitado** pelo código | Uma única rodada de correção |
| Apresenta resposta consolidada | Sim | Execuções reais anteriores | — |

## Por que não é um encaminhador de prompts

Um encaminhador repassaria o pedido a um agente. Alfred:

1. transforma o pedido em objetivo e em um plano com dependências e paralelismo;
2. escolhe os responsáveis pelo papel e pelo "quando acionar" de cada um;
3. fixa, por tarefa, a entrega esperada e critérios mensuráveis;
4. rejeita o próprio plano quando viola regras (duplicidade, skill errada, ciclo, site ou vídeo sem QA);
5. mede o resultado sem confiar no relato do agente (arquivo, tamanho, registro) e cobra;
6. confere o conjunto contra o pedido, aciona outro especialista se um agente pedir e corrige uma vez;
7. controla orçamento por tarefa, execução e dia, e pausa sozinho quando a conta Claude chega ao limite;
8. entrega uma devolutiva única, fiel aos fatos.

## O que Alfred não faz

- Não aprende entre conversas: a memória é o histórico recente, os entregáveis e o workspace.
- Não deixa os agentes conversarem entre si; pedidos de outro especialista passam por ele e valem para **uma** rodada.
- Não garante o mesmo plano para o mesmo pedido.
- Não verifica por código a veracidade de fatos sobre o cliente: isso depende de fontes citadas e da conferência do QA e do usuário.
- Não publica, envia nem gasta: tudo isso abre um pedido de aprovação.

## Como inspecionar o que Alfred faria, sem executar

```bash
npm run plan:preview -- "Alfred, crie um site profissional para esta empresa..."
```

Mostra objetivo, tarefas, agentes, dependências, skills, entregas, critérios e se o plano passou na validação. Custa entre US$ 0,10 e US$ 0,40 por prévia, é registrado e conta no limite diário (as três prévias da fase 2 custaram US$ 0,36 no total). Também disponível em `POST /api/plan-preview`.

## Custo e tamanho

O prompt de planejamento tem cerca de 21 mil caracteres (≈ 5,8 mil tokens), porque carrega o catálogo dos 22 agentes com gatilhos, entregas e skills. Cada chamada do Alfred (planejar ou validar) tem teto de US$ 2.
