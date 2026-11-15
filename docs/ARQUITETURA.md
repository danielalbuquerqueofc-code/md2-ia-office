# Arquitetura — MD2 IA Office 2.0

## Visão geral

```
 Navegador (React)                     Servidor Node (processo persistente)
 ┌──────────────────────┐   HTTP    ┌───────────────────────────────────────────────┐
 │ Central de Comando   │ ───────▶  │ http/app.ts   auth · CSRF · uploads · arquivos │
 │ Execuções · Equipe   │ ◀──SSE──  │      │                                         │
 │ Entregáveis · Aprov. │           │      ▼                                         │
 └──────────────────────┘           │ orchestrator/engine.ts  (Alfred)               │
                                    │   fila · planejamento · DAG de tarefas ·       │
                                    │   paralelismo · retentativa · timeout ·        │
                                    │   validação · correção · consolidação          │
                                    │      │                │                        │
                                    │      ▼                ▼                        │
                                    │ registry/*        runtime/claudeRuntime.ts     │
                                    │  agentes          Claude Agent SDK: 1 sessão   │
                                    │  conhecimento     por tarefa, isolada no       │
                                    │  skills           workspace, guard de          │
                                    │  ferramentas      permissões, MCP interno md2  │
                                    │      │                                         │
                                    │      ▼                                         │
                                    │ SQLite (node:sqlite) + data/ (workspaces,      │
                                    │ uploads, snapshots de entregáveis)             │
                                    └───────────────────────────────────────────────┘
```

A interface é só uma janela. Toda execução vive no servidor e no banco: fechar o navegador não interrompe nada, e reiniciar o processo retoma as execuções (`Engine.recover`).

## Módulos

| Módulo | Arquivo | Responsabilidade |
|---|---|---|
| Configuração | `server/src/config.ts` | Lê `.env`. Recusa expor o serviço na rede sem senha. |
| Banco | `server/src/db.ts` | SQLite em WAL: conversas, mensagens, execuções, tarefas, eventos, entregáveis e versões, aprovações, uploads, auditoria. |
| Eventos | `server/src/events.ts` | Todo evento é persistido e transmitido via SSE (com retomada por `Last-Event-ID`). Só ações reais do runtime geram eventos. |
| Alfred | `server/src/orchestrator/alfred.ts` | Prompts do planejamento e da validação, esquemas JSON e validação estrutural do plano (agentes existentes, dependências, ciclos). |
| Motor | `server/src/orchestrator/engine.ts` | Ciclo da execução (abaixo), fila com limite de execuções simultâneas, semáforo de tarefas paralelas, custos, aprovações e ajustes. |
| Entregáveis | `server/src/orchestrator/deliverables.ts` | Snapshot imutável e versionado de cada entrega (arquivo ou site com `index.html`). |
| Runtime | `server/src/runtime/claudeRuntime.ts` | Integra o **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `runStructured` (saída JSON validada por esquema) para Alfred e `runAgent` (sessão completa com ferramentas) para os agentes. |
| Guard | `server/src/runtime/guard.ts` | Política por chamada de ferramenta (`canUseTool`): escrita só no workspace, leitura só em pastas autorizadas, shell sem comandos destrutivos/publicação/credenciais, rede sem endereços internos. Remove segredos do ambiente do agente. |
| Registro de agentes | `agents/registry.json` + `registry/agents.ts` | 22 agentes, 10 departamentos, instruções, limites, qualidade, skills e ferramentas. |
| Knowledge Engine | `knowledge/<departamento>/*.md` + `registry/knowledge.ts` | Bibliotecas por departamento, recuperação BM25 por seção. |
| Skill Registry | `skills/<área>/<skill>/SKILL.md` + `registry/skills.ts` | Skills no formato do Claude Code, com frontmatter e seções obrigatórias validadas. |
| Tool Registry | `registry/tools.ts` | Catálogo único de ferramentas com status detectado no ambiente. Resolve as ferramentas do agente em permissões do SDK. |
| API | `server/src/http/app.ts`, `auth.ts` | REST + SSE, sessão por cookie assinado, anti-CSRF, upload validado, entrega de arquivos com suporte a Range e isolamento por CSP sandbox. |
| Interface | `web/src` | React 19 + Vite, sem framework de UI; design tokens do briefing em `styles.css`. |

## Ciclo de uma execução

1. **Recebido** — mensagem gravada (idempotente por `clientRequestId`), anexos copiados para `workspace/entrada/`.
2. **Analisando** — verifica limite diário de custo e disponibilidade do runtime; monta contexto (histórico, entregáveis anteriores, árvore do workspace, ferramentas indisponíveis, conhecimento relevante).
3. **Planejando** — Alfred responde em JSON validado por esquema: `resposta_direta` (pergunta simples, nada é executado) ou `plano` com tarefas, agentes, dependências e skills. Plano inválido é devolvido a Alfred com os erros (até 2 tentativas).
4. **Delegado / Executando** — tarefas sem dependências pendentes rodam em paralelo (limite `MD2_MAX_PARALLEL_TASKS`). Cada tarefa é uma sessão independente do SDK com: prompt permanente do agente, instruções de Alfred, resultados das dependências, skills atribuídas na íntegra, trechos de conhecimento do departamento e as ferramentas autorizadas. Falha → nova tentativa retomando a sessão anterior (até `MD2_TASK_MAX_ATTEMPTS`); falha definitiva cancela dependentes. Timeout e orçamento por tarefa são aplicados.
5. **Validando** — Alfred revisa resultados, entregáveis e aprovações. Pode pedir **uma** rodada de correção a tarefas específicas. Depois escreve a devolutiva fiel aos fatos.
6. **Concluído / Aguardando aprovação / Falhou** — se algum agente abriu pedido de aprovação, a execução fica aguardando a decisão humana.

## Ferramentas internas dos agentes (MCP em processo `md2`)

- `registrar_entregavel` — único caminho para algo aparecer na Central de Entregáveis. Valida caminho dentro do workspace, existência, tamanho, e cria snapshot.
- `solicitar_aprovacao` — registra o pedido; o agente é instruído a **não** executar a ação.
- `consultar_conhecimento` — busca na biblioteca.

## Segurança — o que está implementado e o que não está

Implementado e testado: senha obrigatória para expor na rede, cookie `HttpOnly`/`SameSite=Strict` assinado, limite de tentativas de login, cabeçalho anti-CSRF, validação de upload (extensões permitidas, tamanho, nome saneado), bloqueio de path traversal, entregáveis servidos com `Content-Security-Policy: sandbox` (página gerada não acessa a sessão nem a API), guard de ferramentas, remoção de segredos do ambiente dos agentes, regra anti-prompt-injection em todos os prompts, auditoria das decisões humanas, nada publicado/enviado sem aprovação.

Limitações conhecidas:
- O guard é **defesa em profundidade**, não isolamento. Um comando `Bash` permitido ainda pode escrever em caminhos absolutos fora do workspace (por exemplo, o diretório temporário de sessão que a própria CLI do Claude Code cria em `/tmp/claude-*/…/scratchpad`). Para produção multiusuário ou exposta à internet, rode o servidor em **contêiner ou usuário de sistema dedicado**, com acesso de escrita apenas ao `MD2_DATA_DIR`. O SDK oferece a opção `sandbox` (bubblewrap no Linux); ela não foi ativada porque o bubblewrap não está disponível no ambiente onde o sistema foi testado.
- Acesso é de usuário único (administrador). Não há perfis nem permissões por usuário.

## Decisões técnicas

- **Claude Agent SDK** como runtime: entrega o harness completo do Claude Code (ferramentas de arquivo, shell, web, MCP, sessões retomáveis, custo por execução) como biblioteca, rodando em processo persistente próprio — atende ao requisito de não depender de uma sessão interativa, mantendo o Claude Code como motor de execução.
- **SQLite nativo do Node 22** (`node:sqlite`): zero dependências nativas, transacional, suficiente para um operador. A troca por Postgres exige reimplementar apenas `db.ts`.
- **SSE** em vez de WebSocket: o fluxo é servidor → cliente, reconexão e retomada nativas no navegador.
- **BM25 em vez de embeddings**: acervo pequeno e curado; busca determinística, offline e sem custo. Reavaliar quando passar de algumas centenas de documentos.
- **Sites entregues como estáticos autocontidos**: a prévia funciona sem etapa de build e o resultado é publicável em qualquer hospedagem.
