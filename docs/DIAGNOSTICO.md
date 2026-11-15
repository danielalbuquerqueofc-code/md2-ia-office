# Diagnóstico técnico — estado do repositório antes da reformulação

Data da auditoria: 15/11/2026 · Branch: `claude/md2-ia-office-reformulacao-ktmyv0` (criada a partir de `main`, commit `6a85d0e`).

> **CORREÇÃO (fase 2, 15/11/2026).** A primeira versão deste diagnóstico afirmava que o repositório "não continha o MD2 IA Office" e que os 22 agentes "não existiam". **Isso estava errado.** Eu havia inspecionado só a `main` e a branch de trabalho. O trabalho original do MD2 (20 commits de Daniel Albuquerque, 23 a 27/10/2026) existe em branches remotas que eu não abri, incluindo o cadastro dos 22 agentes. Detalhes e evidências: [AGENTES_ORIGINAIS_E_CONFIRMADOS.md](AGENTES_ORIGINAIS_E_CONFIRMADOS.md).

## O que havia no repositório

A `main` é um **fork da extensão de VS Code "Pixel Agents"** (`pablodelucca/pixel-agents`, versão `1.3.0-dev.1`). O trabalho do MD2 está em branches separadas, partindo de uma base oficial do Pixel Agents 1.5:

| Branch remota | Conteúdo | Data da ponta |
|---|---|---|
| `chore/md2-02a-consolidacao` | A mais completa em lógica: **cadastro dos 22 agentes**, armazenamento persistente com integridade, políticas e aprovações de uso único, entrada de demandas pelo Carlos (determinística), fila persistente, contrato de worker, autenticação de operador, executor, worker Codex somente leitura, piloto comercial interno | 27/10/2026 |
| `feat/md2-isometric-polish` | Escritório isométrico com sprites animados (visual) | 29/10/2026 |
| `md2/base-oficial-v1.5`, `feat/md2-*`, `md2/primeira-versao` | Etapas do visual do escritório e da migração para a base oficial | 23/10/2026 |

| Item procurado | Na `main` (o que inspecionei) | Nas branches originais (o que deixei de ver) |
|---|---|---|
| Alfred | Não existia | **Não existe em nenhuma branch** (nenhuma ocorrência) |
| Os 22 agentes | Não existiam | **Existem** (`core/src/md2AgentRegistry.ts`, commit `d4e3933`) |
| Persistência | Só `workspaceState` do VS Code e JSON em `~/.pixel-agents/` | Armazenamento persistente com escopo, integridade e recuperação |
| Runtime de agentes | Nenhum | Executor com worker Codex somente leitura, fila, concessões e aprovações de uso único; execução real exige autorização separada |
| Integrações (Google, Instagram, FFmpeg) | Nenhuma | Nenhuma; WhatsApp só planejado |
| Alterações não commitadas | Nenhuma | — |

A reformulação 2.0 **não reaproveitou** esse código (é TypeScript no estilo do Pixel Agents, ligado ao Codex e ao escritório visual). Ela reaproveitou as **decisões**: capacidades declarativas, aprovações de uso único, escopo, limites e entrada pelo Carlos. Que o código da branch continue disponível para comparação e migração futura.

O que existia na `main` e funcionava: escritório em pixel art (canvas, sprites, editor de layout), detecção de status de terminais Claude Code/Codex via hooks e JSONL, servidor HTTP local para hooks, testes Vitest e Playwright da extensão.

## Principais problemas frente à visão do produto

1. **Natureza errada do produto**: era uma visualização de terminais, não um sistema que executa trabalho. Nenhuma tarefa era delegada, executada ou entregue pelo sistema.
2. **Experiência visual oposta à pedida**: pixel art, personagens caminhando, salas e mesas — exatamente o que deveria sair.
3. **Dependência total da tela aberta**: tudo vivia dentro do VS Code; fechar a janela parava tudo.
4. **Sem orquestração, sem estado de tarefas, sem entregáveis, sem aprovações, sem conhecimento ou skills.**

## Decisões de preservação

- **Nada foi apagado.** Todo o código da extensão foi movido com `git mv` para `legacy/pixel-agents/`, preservando o histórico. A branch `main` permanece intacta.
- O fork não é reaproveitável como base do novo produto (é um renderizador de terminais em canvas). Foi reaproveitado o que era tecnicamente aplicável como **conhecimento**: TypeScript estrito, Vitest, a lição de parear observação com persistência, e o uso do servidor HTTP local.

## Segunda auditoria — operação noturna (15/11/2026)

Estado encontrado no início da operação noturna (versão 2.0 recém-construída) e o que foi feito: ver `docs/SEGURANCA.md` (15 achados, com gravidade e evidência) e `docs/RELATORIO_OPERACAO_NOTURNA.md`. Principais pontos encontrados: comandos dos agentes sem isolamento real; escape por link simbólico; DNS rebinding em modo local; custo de retentativas contado em dobro; verificação do runtime com custo recorrente; recuperação sem limite de tentativas; ausência de backup, health check detalhado e logs estruturados; 3 vulnerabilidades em dependências de desenvolvimento.

## Sobre os 22 agentes

Substituída pela recuperação feita na fase 2: o registro atual usa os 22 agentes do cadastro original (nome, departamento, cargo, descrição e capacidades confirmados no commit `d4e3933`). As competências que a matriz acrescenta continuam **pendentes de confirmação**. Ver [AGENTES_ORIGINAIS_E_CONFIRMADOS.md](AGENTES_ORIGINAIS_E_CONFIRMADOS.md) e [MATRIZ_DE_COMPETENCIAS.md](MATRIZ_DE_COMPETENCIAS.md).
