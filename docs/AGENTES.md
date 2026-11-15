# Auditoria dos 22 agentes

Gerado por `npm run docs:agents` a partir de `agents/registry.json`, `skills/`, `knowledge/` e do Tool Registry. Não editar à mão.

Alfred é o orquestrador central (Diretor de Operações de IA) e **não** faz parte dos 22.

## Origem das identidades

| Situação do nome | Quantidade |
|---|---|
| Confirmado pela especificação | 9 |
| Condicional (Patrícia) | 1 |
| Provisório | 12 |

Nomes provisórios: Thiago (Desenvolvimento e Tecnologia), Bruno (Desenvolvimento e Tecnologia), Camila (Desenvolvimento e Tecnologia), Diego (Desenvolvimento e Tecnologia), Juliana (Atendimento), Larissa (Atendimento), Roberto (Financeiro), Aline (Financeiro), Marcelo (Operações e Projetos), Vanessa (Operações e Projetos), Leonardo (Produção e Conteúdo), Isabela (Produção e Conteúdo).

O cadastro original dos agentes não foi encontrado no repositório (ver `docs/DIAGNOSTICO.md`). Nenhuma identidade provisória deve ser tratada como original. Para corrigir, edite `agents/registry.json` e mude `nameStatus`/`roleStatus`.

## Lacunas encontradas

- Mariana: ferramentas autorizadas ainda não utilizáveis: Playwright (navegador) (configurada, mas não testada).
- Thiago: ferramentas autorizadas ainda não utilizáveis: GitHub (não implementada).
- Thiago: nome provisório; função arquiteto de software e desenvolvedor backend definida na reformulação.
- Bruno: ferramentas autorizadas ainda não utilizáveis: Playwright (navegador) (configurada, mas não testada); GitHub (não implementada).
- Bruno: nome provisório; função desenvolvedor frontend definida na reformulação.
- Camila: nome provisório; função designer de ux/ui definida na reformulação.
- Diego: ferramentas autorizadas ainda não utilizáveis: Playwright (navegador) (configurada, mas não testada).
- Diego: nome provisório; função engenheiro de qualidade e segurança definida na reformulação.
- Juliana: nome provisório; função especialista em atendimento ao cliente definida na reformulação.
- Larissa: nome provisório; função analista de sucesso do cliente definida na reformulação.
- Roberto: nome provisório; função controller financeiro definida na reformulação.
- Aline: nome provisório; função analista de custos e precificação definida na reformulação.
- Marcelo: ferramentas autorizadas ainda não utilizáveis: Google Calendar (não implementada).
- Marcelo: nome provisório; função gerente de projetos definida na reformulação.
- Vanessa: nome provisório; função analista de processos e automação definida na reformulação.
- Leonardo: nome provisório; função diretor criativo e roteirista definida na reformulação.
- Isabela: ferramentas autorizadas ainda não utilizáveis: Transcrição de áudio (parcialmente implementada).
- Isabela: nome provisório; função editora de vídeo e motion definida na reformulação.
- Patrícia: ferramentas autorizadas ainda não utilizáveis: Google Drive (não implementada); Google Calendar (não implementada).

## Ficha por agente

### Carlos — Diretor-geral

| Item | Situação |
|---|---|
| Departamento | Direção |
| Nome | Confirmado pela especificação |
| Função | Especificação |
| Responsabilidade principal | Estratégia empresarial, modelo de negócio, priorização e decisões que cruzam áreas. |
| Conhecimento disponível | 9 documentos (1 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, direcao/estrategia-negocio, financeiro/gestao-financeira, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago, operacoes/gestao-projetos-processos |
| Skills | `project-management` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 6 regras (0 próprias, 1 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Toda recomendação tem premissa, impacto esperado e risco. · Números citados têm origem identificada. · O documento cabe em uma leitura de cinco minutos. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Lucas — Especialista em prospecção

| Item | Situação |
|---|---|
| Departamento | Comercial |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Pesquisa e qualificação de leads, listas de prospecção e abordagens de primeiro contato. |
| Conhecimento disponível | 6 documentos (2 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `lead-research` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Cada lead tem fonte, motivo de encaixe e próximo passo. · Mensagens têm menos de 500 caracteres e um único pedido claro. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Fernanda — Consultora de diagnóstico comercial

| Item | Situação |
|---|---|
| Departamento | Comercial |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Diagnóstico da operação comercial de empresas: funil, conversão, oferta e gargalos. |
| Conhecimento disponível | 6 documentos (2 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `sales-diagnosis` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Cada gargalo tem evidência. · O plano de ação é executável por uma equipe pequena. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Rafael — Especialista em propostas e fechamento

| Item | Situação |
|---|---|
| Departamento | Comercial |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Propostas comerciais, precificação de oferta, negociação e contorno de objeções. |
| Conhecimento disponível | 6 documentos (2 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `proposal-generation` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Proposta legível em celular, com próximo passo único. · Nenhum valor ou prazo inventado. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Helena — Analista jurídica

| Item | Situação |
|---|---|
| Departamento | Jurídico |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Contratos de prestação de serviços, direito empresarial brasileiro e adequação à LGPD. |
| Conhecimento disponível | 1 documentos (1 do próprio departamento): juridico/contratos-lgpd |
| Skills | `contract-review` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Riscos classificados (alto, médio, baixo) com justificativa. · Nenhuma referência legal citada sem segurança. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Mariana — Analista de pesquisa e inteligência de mercado

| Item | Situação |
|---|---|
| Departamento | Marketing |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Pesquisa de empresas, público, concorrentes e presença digital (site, Google, Instagram). |
| Conhecimento disponível | 6 documentos (4 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `market-research` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web, Análise de imagens |
| Ferramentas pendentes | Playwright (navegador) (configurada, mas não testada) |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Fatos com fonte; inferências marcadas como inferência. · Briefing com serviços, diferenciais, público, tom de voz, contatos e lacunas. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Beatriz — Estrategista de marca e comunicação

| Item | Situação |
|---|---|
| Departamento | Marketing |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Posicionamento, identidade verbal e visual aplicada, e estratégia de comunicação. |
| Conhecimento disponível | 6 documentos (4 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `brand-strategy` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web, Análise de imagens |
| Ferramentas pendentes | — |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Direção visual com paleta acessível (contraste AA) e tipografia definida. · Mensagens específicas da empresa, sem frases genéricas. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Gabriel — Gestor de tráfego pago

| Item | Situação |
|---|---|
| Departamento | Marketing |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Planejamento e estruturação de campanhas em Meta Ads e Google Ads para geração de clientes. |
| Conhecimento disponível | 6 documentos (4 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `meta-ads` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Plano com orçamento diário, público e métrica de sucesso por campanha. · Sem promessas de custo por lead ou retorno. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Pedro — Redator e produtor de conteúdo

| Item | Situação |
|---|---|
| Departamento | Marketing |
| Nome | Confirmado pela especificação |
| Função | Definida na reformulação |
| Responsabilidade principal | Copywriting para sites, anúncios, páginas de venda e redes sociais. |
| Conhecimento disponível | 6 documentos (4 do próprio departamento): comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao, marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago |
| Skills | `copywriting` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Cada seção tem um objetivo e uma chamada para ação. · Texto revisado, sem clichês e sem erros de português. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Thiago — Arquiteto de software e desenvolvedor backend

| Item | Situação |
|---|---|
| Departamento | Desenvolvimento e Tecnologia |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Arquitetura, APIs, banco de dados, integrações e automações. |
| Conhecimento disponível | 2 documentos (2 do próprio departamento): desenvolvimento/backend-seguranca-deploy, desenvolvimento/frontend-ux-seo-tecnico |
| Skills | `website-builder`, `security-audit` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código, Pesquisa e leitura web |
| Ferramentas pendentes | GitHub (não implementada) |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Código executa sem erros no workspace. · Há instruções de como rodar. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Bruno — Desenvolvedor frontend

| Item | Situação |
|---|---|
| Departamento | Desenvolvimento e Tecnologia |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Construção de sites e interfaces responsivas, performáticas e acessíveis. |
| Conhecimento disponível | 2 documentos (2 do próprio departamento): desenvolvimento/backend-seguranca-deploy, desenvolvimento/frontend-ux-seo-tecnico |
| Skills | `website-builder` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código, Pesquisa e leitura web, Análise de imagens |
| Ferramentas pendentes | Playwright (navegador) (configurada, mas não testada); GitHub (não implementada) |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | HTML semântico, um h1, metadados e Open Graph preenchidos. · Sem erros no console; links, formulário e botão de WhatsApp funcionais. · Layout íntegro em 360, 768 e 1280 px. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Camila — Designer de UX/UI

| Item | Situação |
|---|---|
| Departamento | Desenvolvimento e Tecnologia |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Arquitetura da informação, layout, sistemas visuais e experiência de uso. |
| Conhecimento disponível | 2 documentos (2 do próprio departamento): desenvolvimento/backend-seguranca-deploy, desenvolvimento/frontend-ux-seo-tecnico |
| Skills | `ui-design` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web, Análise de imagens |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Hierarquia visual clara e contraste AA. · Especificação suficiente para implementar sem dúvidas. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Diego — Engenheiro de qualidade e segurança

| Item | Situação |
|---|---|
| Departamento | Desenvolvimento e Tecnologia |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Testes funcionais, responsivos e de acessibilidade, e auditoria de segurança. |
| Conhecimento disponível | 2 documentos (2 do próprio departamento): desenvolvimento/backend-seguranca-deploy, desenvolvimento/frontend-ux-seo-tecnico |
| Skills | `quality-assurance`, `security-audit` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código, Pesquisa e leitura web, Análise de imagens, FFmpeg |
| Ferramentas pendentes | Playwright (navegador) (configurada, mas não testada) |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Cada verificação tem método e resultado. · Nenhum item marcado como verificado sem ter sido executado. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Juliana — Especialista em atendimento ao cliente

| Item | Situação |
|---|---|
| Departamento | Atendimento |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Respostas a clientes, resolução de dúvidas e padronização do atendimento. |
| Conhecimento disponível | 3 documentos (1 do próprio departamento): atendimento/atendimento-sucesso, comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao |
| Skills | `customer-reply` |
| Ferramentas utilizáveis | Arquivos do workspace |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Resposta resolve a dúvida na primeira leitura. · Tom alinhado à marca, sem culpa ao cliente. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Larissa — Analista de sucesso do cliente

| Item | Situação |
|---|---|
| Departamento | Atendimento |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Onboarding, acompanhamento de resultados, retenção e relatórios para clientes. |
| Conhecimento disponível | 3 documentos (1 do próprio departamento): atendimento/atendimento-sucesso, comercial/diagnostico-proposta-fechamento, comercial/prospeccao-qualificacao |
| Skills | `customer-reply` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Relatório compreensível por um empresário não técnico. · Próximos passos com datas. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Roberto — Controller financeiro

| Item | Situação |
|---|---|
| Departamento | Financeiro |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Fluxo de caixa, DRE gerencial, indicadores e planejamento financeiro. |
| Conhecimento disponível | 1 documentos (1 do próprio departamento): financeiro/gestao-financeira |
| Skills | `financial-analysis` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Totais conferidos por cálculo executado. · Premissas listadas. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Aline — Analista de custos e precificação

| Item | Situação |
|---|---|
| Departamento | Financeiro |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Custos, margem, precificação de serviços e viabilidade de ofertas. |
| Conhecimento disponível | 1 documentos (1 do próprio departamento): financeiro/gestao-financeira |
| Skills | `financial-analysis` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Fórmulas explícitas e verificadas. · Impostos e custos indiretos considerados ou declarados como fora do escopo. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Marcelo — Gerente de projetos

| Item | Situação |
|---|---|
| Departamento | Operações e Projetos |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Planejamento, cronogramas, escopo, riscos e acompanhamento de entregas. |
| Conhecimento disponível | 1 documentos (1 do próprio departamento): operacoes/gestao-projetos-processos |
| Skills | `project-management` |
| Ferramentas utilizáveis | Arquivos do workspace |
| Ferramentas pendentes | Google Calendar (não implementada) |
| Limites de atuação | 6 regras (0 próprias, 1 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Cada tarefa tem critério de conclusão. · Cronograma coerente com as dependências. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Vanessa — Analista de processos e automação

| Item | Situação |
|---|---|
| Departamento | Operações e Projetos |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Mapeamento de processos, procedimentos operacionais e oportunidades de automação. |
| Conhecimento disponível | 1 documentos (1 do próprio departamento): operacoes/gestao-projetos-processos |
| Skills | `project-management` |
| Ferramentas utilizáveis | Arquivos do workspace, Pesquisa e leitura web |
| Ferramentas pendentes | — |
| Limites de atuação | 6 regras (0 próprias, 1 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Procedimento executável por alguém novo na função. · Responsáveis e gatilhos definidos em cada etapa. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Leonardo — Diretor criativo e roteirista

| Item | Situação |
|---|---|
| Departamento | Produção e Conteúdo |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Conceito criativo, roteiro e direção de vídeos curtos, reels e peças publicitárias. |
| Conhecimento disponível | 5 documentos (1 do próprio departamento): marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago, producao/video-curto |
| Skills | `reels-production` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código, FFmpeg, Análise de imagens |
| Ferramentas pendentes | — |
| Limites de atuação | 7 regras (0 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Soma dos planos igual à duração pedida. · Cada plano referencia um arquivo existente. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Isabela — Editora de vídeo e motion

| Item | Situação |
|---|---|
| Departamento | Produção e Conteúdo |
| Nome | **Provisório** |
| Função | Definida na reformulação |
| Responsabilidade principal | Edição com FFmpeg: cortes, montagem, formato vertical, textos, cor e áudio. |
| Conhecimento disponível | 5 documentos (1 do próprio departamento): marketing/analytics, marketing/posicionamento-copy, marketing/seo-marketing-local, marketing/trafego-pago, producao/video-curto |
| Skills | `video-editing`, `reels-production` |
| Ferramentas utilizáveis | Arquivos do workspace, Execução de código, FFmpeg, Análise de imagens |
| Ferramentas pendentes | Transcrição de áudio (parcialmente implementada) |
| Limites de atuação | 8 regras (1 próprias, 2 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | MP4 H.264 + AAC, 1080x1920, 30 fps, reproduzível. · Duração dentro de meio segundo do pedido. · Textos legíveis e dentro da área segura. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |

### Patrícia — Assistente administrativa

| Item | Situação |
|---|---|
| Departamento | Administrativo |
| Nome | Condicional ("caso esse seja o nome cadastrado") |
| Função | Definida na reformulação |
| Responsabilidade principal | Organização de documentos, agenda, atas, comunicados e rotinas administrativas. |
| Conhecimento disponível | 2 documentos (1 do próprio departamento): administrativo/rotinas-administrativas, operacoes/gestao-projetos-processos |
| Skills | `project-management` |
| Ferramentas utilizáveis | Arquivos do workspace |
| Ferramentas pendentes | Google Drive (não implementada); Google Calendar (não implementada) |
| Limites de atuação | 6 regras (0 próprias, 1 do departamento, 5 comuns), sempre com aprovação humana para ações externas |
| Critérios de conclusão | Documentos com data, responsável e próximos passos. · Sem erros de português. |
| Formato de entrega ao Alfred | Padrão comum: resumo, o que foi feito, arquivos, verificações, pendências; entregáveis via `registrar_entregavel` |
