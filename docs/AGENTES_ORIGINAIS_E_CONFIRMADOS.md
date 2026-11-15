# Agentes originais e confirmados

Recuperação da estrutura original dos 22 agentes do MD2, feita em 15/11/2026 a partir do histórico completo do repositório. Esta página separa o que tem **evidência** do que continua **PENDENTE DE CONFIRMAÇÃO**.

## 1. Correção de um erro meu

Nos documentos anteriores (`docs/DIAGNOSTICO.md`, versão de 15/11/2026), eu afirmei que "o cadastro original dos agentes não estava no repositório" e que o projeto "não continha o MD2 IA Office". **Isso estava errado.** Eu havia inspecionado só a árvore da `main` e a branch de trabalho, que são o fork limpo do Pixel Agents, e não percorri as demais branches remotas. O trabalho original do MD2 (20 commits de Daniel Albuquerque entre 23 e 27/10/2026) existe em branches remotas que eu não tinha aberto.

Consequência prática: o registro que eu criei na reformulação tinha **12 identidades erradas** (seção 5). Ele foi substituído pelo cadastro original; ver o relatório da fase 2.

## 2. Onde está a evidência

| Fonte | O que contém | Confiança |
|---|---|---|
| Branch `origin/chore/md2-02a-consolidacao`, commit **`d4e3933`** (27/10/2026, Daniel Albuquerque, "register 22 inactive business agents with validation") — arquivo `core/src/md2AgentRegistry.ts` | O registro dos 22 agentes: id, nome, departamento, cargo, descrição e capacidades | **Alta.** É código seu, com validador que rejeita qualquer registro que não tenha exatamente 22 agentes na distribuição correta |
| Mesma branch, `core/src/md2Foundation.ts` | Os 10 departamentos de negócio, quantidade de agentes por departamento e capacidades permitidas por departamento | **Alta** |
| Mesma branch, `docs/md2/DIRECTOR.md` | Tabela "intenção → responsável" com os 22 nomes; Carlos como porta de entrada | **Alta** (consistente com o registro) |
| Mesma branch, `docs/md2/PILOT.md` | Papéis de Carlos, Lucas, Fernanda e Rafael no piloto comercial; registra que o seu pedido original dizia "Fernanda propostas e Rafael acompanhamento" e que **o cadastro foi preservado** (Fernanda = qualificação, Rafael = propostas) | **Alta** |
| Mesma branch, `docs/md2/README.md` | Estrutura planejada anterior: 7 departamentos visuais e 20 posições (seção 4) | Média (planejamento anterior ao registro) |
| Demais branches (`md2/base-oficial-v1.5`, `md2/primeira-versao`, `feat/md2-*`) | Visual do escritório; **nenhuma contém o registro dos agentes** (conferido por busca nos 22 nomes) | — |
| Branch `main` e tags | Nenhum registro de agentes; sem tags, sem stashes | — |
| Menções a "Alfred" em qualquer branch original | **Nenhuma** | — |

Cópias literais dos arquivos-chave estão preservadas em `docs/evidencias/md2-original/`, e o registro original extraído mecanicamente está em `agents/original-registry.json`. Um teste automatizado (`server/test/agents-identity.test.ts`) falha se o registro atual divergir do original em nome, departamento, cargo ou capacidades.

## 3. Estrutura original confirmada

### Departamentos (10, total de 22 agentes)

| Departamento | Agentes |
|---|---:|
| Direção-Geral | 1 |
| Comercial | 3 |
| Marketing | 4 |
| Tecnologia | 4 |
| Atendimento | 2 |
| Financeiro | 2 |
| Operações e Projetos | 2 |
| Produção e Conteúdo | 2 |
| Jurídico | 1 |
| Administrativo | 1 |

Bate exatamente com a distribuição que você informou.

### Os 22 agentes, com o texto original

Todos nasceram com `initialState: inactive` (cadastro sem execução). As capacidades originais são **declarativas** ("atividades sobre informações fornecidas, nunca concessões de ferramenta executável").

| Agente | Departamento | Cargo (original) | Descrição (original) | Capacidades originais |
|---|---|---|---|---|
| Carlos | Direção-Geral | Diretor-geral | Planeja a estratégia e revisa prioridades empresariais. | `strategy.plan`, `work.review` |
| Lucas | Comercial | Analista de prospecção | Analisa oportunidades a partir de informações fornecidas. | `leads.analyze` |
| Fernanda | Comercial | Analista de qualificação | Avalia necessidades e adequação de potenciais clientes. | `leads.analyze` |
| Rafael | Comercial | Analista de propostas | Elabora minutas de propostas para revisão. | `proposals.draft` |
| Mariana | Marketing | Estrategista de marketing | Planeja campanhas e posicionamento. | `campaigns.plan` |
| Beatriz | Marketing | Analista de marca | Planeja comunicação e consistência de marca. | `campaigns.plan` |
| Gabriel | Marketing | Analista de desempenho | Analisa indicadores de marketing fornecidos. | `marketing.analyze` |
| Pedro | Marketing | Planejador de mídia | Elabora planos de mídia sem publicar campanhas. | `campaigns.plan`, `marketing.analyze` |
| André | Tecnologia | Programador | Elabora propostas de código para revisão. | `code.draft` |
| Camila | Tecnologia | Arquiteta de software | Desenha soluções e contratos técnicos. | `software.design` |
| Diego | Tecnologia | Analista de automação | Desenha fluxos de automação sem conectar serviços. | `software.design`, `code.draft` |
| Sofia | Tecnologia | Analista de qualidade | Planeja cenários de teste e critérios de aceite. | `tests.plan` |
| Juliana | Atendimento | Analista de suporte | Classifica solicitações e prepara respostas. | `support.triage`, `replies.draft` |
| Bruno | Atendimento | Analista de relacionamento | Prepara respostas de acompanhamento e retenção. | `replies.draft` |
| Renata | Financeiro | Analista financeiro | Analisa informações financeiras fornecidas. | `finance.analyze` |
| Eduardo | Financeiro | Analista de controle financeiro | Elabora relatórios financeiros para revisão. | `finance.reports.draft` |
| Thiago | Operações e Projetos | Coordenador de projetos | Planeja atividades, dependências e entregas. | `projects.plan` |
| Amanda | Operações e Projetos | Analista de entregas | Revisa entregas segundo critérios fornecidos. | `deliveries.review` |
| Isabela | Produção e Conteúdo | Redatora | Elabora conteúdo a partir de briefings. | `content.draft` |
| Vinícius | Produção e Conteúdo | Editor de conteúdo | Revisa clareza e consistência do conteúdo. | `content.review` |
| Helena | Jurídico | Analista jurídico | Prepara análises e minutas para revisão humana. | `legal.review`, `legal.documents.draft` |
| Patrícia | Administrativo | Analista administrativo | Organiza registros e planeja rotinas administrativas. | `records.organize`, `administration.plan` |

**Patrícia está confirmada.** Sua dúvida ("incluindo Patrícia caso esse seja o nome cadastrado") está resolvida: o nome consta no cadastro, no Administrativo.

## 4. Informações adicionais do projeto original

**Duas estruturas coexistiam no original.** O `README.md` do MD2 original descrevia um escritório visual com **7 departamentos e 20 posições** (Diretoria e Estratégia 2, Comercial e Vendas 4, Marketing 3, Operações 3, Atendimento 2, Financeiro 2, Tecnologia 4), declaradas "planejamento, não vinte execuções ativas". Em 27/10/2026 você registrou a estrutura de negócio de **10 departamentos e 22 agentes**, e o código afirma que os departamentos visuais "ficam independentes" dela. O registro de 22 é a estrutura vigente; os 7 departamentos eram o planejamento visual anterior.

**Posições do planejamento visual que não têm correspondente nos 22:** *Fechamento* (Comercial e Vendas), *Design* (Operações), *Cobrança* (Financeiro) e *Direção de IA / Planejamento* (Diretoria). O cadastro de 22 não tem designer, nem editor de vídeo, nem agente de cobrança.

**Carlos no original** não era um orquestrador de IA: era o ponto de entrada. O `Md2Director` recebia a demanda de uma sessão autenticada, classificava por regras determinísticas (sem modelo de IA) e propunha um responsável conforme a tabela "intenção → agente". Isso é compatível com a sua decisão atual de que **Alfred é o orquestrador e fica fora dos 22**; Carlos permanece "Diretor-geral" (estratégia e revisão de prioridades).

**Runtime original:** programador via **Codex** (`codex-programmer`), com fila, aprovações de uso único, concessões e limites. A versão 2.0 usa o Claude Agent SDK; as ideias de aprovação, escopo e limite foram mantidas, o executor não.

## 5. O que eu havia criado e estava errado

Comparação entre o registro da reformulação 2.0 (antes da fase 2) e o original:

| Situação | Agentes |
|---|---|
| **Inventados (não existem no original)** | Roberto, Aline (financeiro), Marcelo, Vanessa (operações), Larissa (atendimento), Leonardo (produção) |
| **Existem no original e eu havia omitido** | André, Sofia (tecnologia), Renata, Eduardo (financeiro), Amanda (operações), Vinícius (produção) |
| **Nome certo, departamento errado** | Bruno (era atendimento; eu o pus em desenvolvimento), Thiago (era operações; pus em desenvolvimento) |
| **Nome certo, cargo errado** | Camila (arquiteta de software, não designer de UX/UI), Diego (analista de automação, não QA/segurança), Isabela (redatora, não editora de vídeo), Pedro (planejador de mídia, não redator), Gabriel (analista de desempenho, não gestor de tráfego), Mariana (estrategista, não pesquisadora), Juliana, Lucas, Fernanda, Rafael, Beatriz (cargo reescrito por mim) |
| **Corretos desde o início** | Carlos (departamento e cargo), Helena e Patrícia (departamento); o texto do cargo também foi reescrito por mim |

Comercial e Marketing tinham os nomes certos, mas com funções diferentes das originais. O primeiro comando listava só nomes para essas funções, e eu preenchi as lacunas sem ter consultado o cadastro: foi aí que errei.

## 6. Situação de cada informação

### CONFIRMADO (evidência no cadastro original)
Nome, departamento, cargo, descrição e capacidades dos 22 agentes; os 10 departamentos e a distribuição 1-3-4-4-2-2-2-2-1-1.

### DEFINIDO NESTA REFORMULAÇÃO, por instrução sua (não está no repositório antigo)
Alfred como orquestrador central fora dos 22.

### PENDENTE DE CONFIRMAÇÃO (proposta minha, nunca aprovada por você)
Tudo o que a matriz de competências acrescenta além do cadastro original: responsabilidades secundárias, skills, ferramentas permitidas e proibidas, limites de autonomia, gatilhos de acionamento, formato de entrega e critérios de qualidade. O cadastro original dizia apenas "elabora, planeja, analisa, revisa". **Executar de verdade** (rodar código, FFmpeg, testes) é uma ampliação em relação a "para revisão"; cada produto continua sendo rascunho até a sua aprovação.

### LACUNAS DE PAPEL — decisão sua
1. **Edição de vídeo e motion**: nenhum dos 22 tem esse cargo. "Editor de conteúdo" (Vinícius) está descrito como revisão de clareza e consistência, o que se lê como texto. Atribuição provisória, para o cenário de Reels poder rodar: roteiro e legenda com Isabela, revisão com Vinícius, montagem em FFmpeg com **Diego** (automação), conferência técnica com Sofia. **PENDENTE DE CONFIRMAÇÃO.**
2. **Design de interface/identidade visual**: não existe designer. Provisoriamente, estrutura da página e sistema técnico com Camila; direção visual aplicada com Beatriz. **PENDENTE.**
3. **Fechamento (vendas) e Cobrança (financeiro)**: estavam no planejamento visual e não viraram agentes. Hoje ficam com Rafael (propostas e negociação) e Eduardo/Renata. **PENDENTE.**
4. **Gênero dos cargos**: o original usa "Analista jurídico" (Helena) e "Analista administrativo" (Patrícia) no masculino genérico. Mantive o texto original.

## 7. Como isso é protegido daqui para a frente

- `agents/original-registry.json` guarda o cadastro original extraído do código.
- O teste `server/test/agents-identity.test.ts` falha se nome, departamento, cargo, descrição ou capacidades de qualquer agente divergirem do original, e se existir algum agente que não esteja no original.
- No `agents/registry.json`, cada agente tem `identity.status = "confirmado_no_cadastro_original"` e `competencies.status = "proposta_pendente_de_confirmacao"`. Só mude o segundo para `confirmado` quando você aprovar.
