# Relatório da operação noturna — 15/11/2026

Fase: consolidação, segurança e autonomia operacional. Branch `claude/md2-ia-office-reformulacao-ktmyv0`. A `main` não foi tocada; não houve merge, deploy, publicação, envio a clientes, gasto em contas externas nem aumento do teto de custos. Nenhum dado, histórico ou entregável foi apagado.

## 1. O que foi encontrado

Auditoria completa em `docs/SEGURANCA.md` (15 achados). Os mais relevantes:

- **Sem isolamento real dos agentes.** Um comando `Bash` de um agente podia escrever fora do workspace, ler arquivos de outros clientes, ler o banco e ler a chave da API. O filtro de comandos existente não é isolamento.
- **Escape por link simbólico** no guard e no registro de entregáveis.
- **DNS rebinding** possível no modo local sem senha.
- **Custos:** retentativas contadas em dobro; verificação do runtime fazendo chamada paga a cada 5 min com a interface aberta (~US$ 4,60/dia parado); sem limite por tarefa; chamadas do Alfred sem teto.
- **Recuperação sem limite**, com risco de ciclo infinito; anexos com o mesmo nome se sobrescreviam; clique duplo em "ajustar" duplicava execuções.
- **Sem backup, sem health check útil, sem logs estruturados.**
- 3 vulnerabilidades em dependências de desenvolvimento (2 críticas).
- URL malformada derrubava o tratamento de erros da requisição.
- 12 agentes com nome provisório, sem distinção formal dos confirmados.

Encontrados **durante os testes reais** desta noite (não estavam na auditoria inicial):

- A detecção do sandbox dava "falta socat" com o socat instalado (`socat --version` não existe).
- O espelho de backup recopiava todos os arquivos a cada execução (precisão de data).
- O limite de uso de 5 horas da conta Claude era tratado como erro comum: gastava as tentativas em segundos e falhava a execução.
- `TMPDIR` dentro do workspace estourava o limite de caminho de sockets Unix e o Chrome do QA não subia.
- A auditoria não guardava qual comando o guard bloqueou.
- `@playwright/mcp@latest` sem versão fixada (risco de cadeia de suprimentos).

## 2. O que foi corrigido

Todos os itens acima, cada um com teste automatizado ou execução real: links simbólicos, Host/Origin, URL malformada, custo em dobro, verificação paga recorrente, limite de recuperação, anexos, duplicidade, detecção do socat, espelho incremental, pausa por limite de conta, temporário curto, alvo do bloqueio na auditoria, versão fixada do Playwright MCP, Vitest 5 (0 vulnerabilidades).

## 3. O que foi implementado

- **Sandbox de SO para os agentes** (bubblewrap via Claude Agent SDK): escrita só no workspace; leitura de `data/` negada exceto o próprio workspace; credenciais negadas; rede dos comandos passa pelo guard. Modos `auto`, `required`, `off`. `npm run sandbox:check` pede a um agente real para tentar violar o isolamento.
- **Recuperação automática com limites**: retoma a sessão salva do agente; `MD2_MAX_RECOVERIES` por execução; tentativas por tarefa; interrupções registradas.
- **Pausa e retomada por limite de uso da conta**: tarefa volta à fila sem consumir tentativa; verificação periódica; desistência explícita após o prazo máximo.
- **Backup**: snapshots verificados (SHA-256 + `integrity_check`), espelho incremental de arquivos, retenção que nunca fica sem backup, restauração apenas em diretório novo; automático a cada 6 h; CLI e interface.
- **Monitoramento**: `/api/health` público mínimo, `/api/health/details` com banco, disco, tarefas travadas, runtime, isolamento e backup; falhas críticas no log e na auditoria.
- **Logs estruturados** (JSON, arquivo diário, 30 dias) com mascaramento de segredos.
- **Controle de custos**: teto por tarefa (US$ 5), tetos de execução e dia inalterados (US$ 15 / US$ 60), teto para as chamadas do Alfred, cancelamento das pendentes quando o orçamento esgota, etapas e tokens por tarefa, `/api/costs` com alertas de consumo.
- **Agentes**: `nameStatus`/`roleStatus` no registro; `docs/AGENTES.md` gerado dos registros reais; sinalização na interface.
- **Integrações**: classificação por evidência no Tool Registry e na interface; WhatsApp incluído.
- **Interface**: Configurações com saúde, isolamento, backups, consumo e teste de conexão.

## 4. Testes que passaram

| Teste | Resultado |
|---|---|
| Tipagem | Passou |
| Unitários/integração | 63/63 (eram 35) |
| Interface E2E (desktop, celular, tablet) | 39/39 |
| Build de produção | Passou |
| `npm audit` | 0 vulnerabilidades |
| Inicialização do servidor | Saudável; sandbox ativo; backup automático verificado em segundos |
| Sandbox — tentativas reais de violação (2 rodadas, uma pelo caminho de código das tarefas) | Escrita fora negada; workspace vizinho e banco invisíveis; chave da API vazia; temporário próprio gravável |
| Backup com dados reais (execução do site) | Criado e verificado; incremental 0 arquivos; corrupção de 1 byte detectada; restauração em diretório novo; servidor subiu com os dados restaurados e serviu o site; recusou sobrescrever |
| Playwright MCP direto (sem modelo) | Inicializa, 25 ferramentas, navega em HTTP |
| **Operação real 1 — queda e retomada** | 17/18. `SIGKILL` com duas tarefas paralelas; retomada; 3 tarefas concluídas; 2 entregáveis; 2 aprovações abertas pelos agentes; aprovação registrada sem executar nada; auditoria |
| **Operação real 2 — landing page com sandbox** | 11/12. Construção, QA em 4 larguras com Chrome headless, v2 e laudo |
| **Operação real 3 — Reels com sandbox e pasta autorizada** | 16/17. Análise, roteiro, edição FFmpeg, QA, MP4 conferido; material avaliado como impróprio para publicar |

Itens do roteiro pedido (1 a 10) cobertos nas operações reais: recebimento, escolha do departamento, delegação, paralelismo (operação 1), consolidação, entregável real, prévia, aprovação em ambiente de teste, histórico e versões, registro de falhas e pendências.

## 5. Testes que falharam

| Teste | O que falhou | Causa | Situação |
|---|---|---|---|
| Operação 1, verificação "sandbox ativo" | Sandbox inativo naquela execução | Defeito de detecção do socat | Corrigido; operações 2 e 3 rodaram com sandbox ativo. A queda/retomada **não** foi repetida com sandbox |
| Landing page (1ª tentativa) | Execução falhou | Limite de uso de 5 h da conta Claude | Repetida com sucesso; originou a pausa automática |
| Reels (1ª tentativa) | Execução falhou | Mesmo limite | Repetida com sucesso |
| Operações 2 e 3, verificação "tarefas em paralelo" | Reprovada | Planos sequenciais por natureza (construir → testar); a verificação não se aplica | Paralelismo comprovado na operação 1 |
| E2E de interface, "senha errada é recusada" (celular/tablet), na primeira versão do teste | Reprovada | Defeito do próprio teste (não esperava o aviso aparecer) | Teste corrigido |

Não validado, por bloqueio: **edição de vídeo com filmagens reais** (não há material real e a rede bloqueia acervos públicos); site completo de 6 agentes com sandbox; sandbox em macOS/Windows; contêiner/systemd (sem daemon neste ambiente).

## 6. Riscos que continuam abertos

1. Processo servidor não isolado; contêiner ou usuário dedicado recomendados e não testados.
2. `/tmp` gravável dentro do sandbox; ferramentas de arquivo do runtime protegidas pelo guard, não pelo sandbox de SO.
3. Usuário único, sem perfis.
4. Aprovar não executa nada: não há conectores externos.
5. Backup no mesmo disco por padrão.
6. Identidade dos agentes não confirmada (12 nomes provisórios; 21 funções definidas na reformulação).
7. Dependência do limite de uso da conta Claude: o sistema pausa e retoma, mas o trabalho para enquanto o limite não volta.
8. Um bloqueio do guard por "acesso a credenciais" ocorreu no QA da landing page antes de a auditoria guardar o comando; não foi possível confirmar se era falso positivo. Os padrões novos (`_TOKEN`, `API_KEY`, `set |`) são amplos e podem bloquear comandos legítimos; agora o alvo fica registrado para calibrar.
9. Trilha de auditoria alterável por quem tem acesso ao arquivo do banco.

## 7. Integrações realmente funcionais

Funcionais e testadas: **Claude Agent SDK / Claude Code**, arquivos e shell (com sandbox), pesquisa web, análise de imagem, **FFmpeg** (só com material sintético).
Configurada, não testada por agente: Playwright MCP. Parciais: WhatsApp (só links `wa.me`), transcrição (whisper ausente).
**Não implementadas:** GitHub, Google Drive, Google Calendar, Instagram, envio por WhatsApp, geração de imagens. Detalhes em `docs/INTEGRACOES.md`.

## 8. O que depende de aprovação ou ação humana

- Fornecer o cadastro original dos agentes.
- Definir `MD2_BACKUP_DIR` externo, `MD2_AUTHORIZED_DIRS`, senha e `MD2_AGENT_SANDBOX=required` no servidor de produção (e instalar `bubblewrap` e `socat`).
- Fornecer uma pasta com filmagens reais para validar a edição.
- Credenciais e prioridade das integrações (Instagram, WhatsApp Business, Google, GitHub, imagens).
- Decidir sobre merge na `main` e sobre deploy.
- Nos dados de teste há aprovações pendentes criadas pelos agentes (envio de proposta e gasto de mídia da "Padaria Exemplo"); são dados fictícios em `data-noturno/`, fora do versionamento.

## 9. Custos efetivamente consumidos nesta operação

| Item | US$ |
|---|---|
| Testes diretos do sandbox (4 chamadas mínimas) | 0,26 |
| Operação 1 — queda e retomada | 1,61 |
| Landing page, 1ª tentativa (interrompida pelo limite da conta) | 0,46 |
| Reels, 1ª tentativa (interrompida pelo limite da conta) | 0,07 |
| Operação 2 — landing page | 1,54 |
| Operação 3 — Reels | 2,87 |
| Verificações de conectividade do runtime (estimado, ~6 chamadas) | 0,10 |
| **Total aproximado** | **6,91** |

Valores estimados pelo SDK (não são fatura). Nenhuma execução passou do teto por execução (US$ 15) nem por tarefa (US$ 5); a tarefa mais cara foi o QA do Reels (US$ 1,09). O site completo de US$ 9 não foi repetido, para não gastar sem necessidade. Custo por agente e alertas: Configurações → Consumo.

Observação de consumo: o QA (Diego) é a etapa mais cara nos três fluxos, por refazer exportações e checagens; é o primeiro candidato a modelo mais econômico ou a limite de etapas menor.

## 10. Próxima etapa recomendada

1. **Validar com material real de um cliente** (uma pasta de vídeos e um site completo) em servidor Linux com `MD2_AGENT_SANDBOX=required`.
2. **Conector do Instagram ligado ao centro de aprovações** — transforma "aprovar" em ação real e é o maior ganho operacional.
3. Colocar o servidor em contêiner/usuário dedicado, com HTTPS, senha, backup externo e monitor externo no `/api/health`.
4. Corrigir o cadastro dos agentes com os dados originais.
5. Calibrar modelos por tarefa (QA e pesquisa) com os custos medidos.

## Evidências

- Código e testes: commits `9ea32c3` a `HEAD` nesta branch.
- Roteiros reexecutáveis: `npm test`, `npm run e2e`, `npm run sandbox:check`, `npm run backup -- verify all`, `node e2e/real-operation.mjs "<pedido>"`.
- Dados das execuções reais (fora do versionamento, preservados no ambiente da sessão): `data-noturno*/` e os relatórios `data-noturno*-relatorio.json`.
