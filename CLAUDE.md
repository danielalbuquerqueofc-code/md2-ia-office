# MD2 IA Office — referência para o Claude Code

Plataforma em que o usuário conversa com Alfred (orquestrador) e 22 agentes executam tarefas reais via Claude Agent SDK. Leia `docs/ARQUITETURA.md` antes de mudanças estruturais. A versão anterior (extensão Pixel Agents) está em `legacy/pixel-agents/` e não é mais compilada.

## Comandos

- `npm run dev` — servidor (tsx watch, porta 4310) + Vite (5173, proxy para /api e /files)
- `npm run typecheck` · `npm test` (Vitest, `server/test`) · `npm run build` · `npm run e2e` (requer build)
- `npm run smoke:runtime -- "<pedido>" [arquivos]` — execução REAL, consome créditos; usa `./data-smoke`
- `node e2e/real-operation.mjs "<pedido>" [--sem-queda]` — operação REAL pela API, com queda e retomada do servidor
- `npm run sandbox:check` — pede a um agente real para tentar violar o isolamento (chamada pequena, paga)
- `npm run backup [-- list | verify all | restore <snapshot> <novo-dir>]` · `npm run docs:agents` (regenera `docs/AGENTES.md`)

## Mapa

- `server/src/orchestrator/engine.ts` — ciclo da execução, fila, paralelismo, retentativas, custo, aprovações
- `server/src/orchestrator/alfred.ts` — prompts e esquemas de planejamento/validação; `validatePlan`
- `server/src/runtime/claudeRuntime.ts` — único ponto de contato com o SDK; `guard.ts` — política de ferramentas
- `server/src/registry/*` — agentes (`agents/registry.json`), conhecimento (`knowledge/`), skills (`skills/`), ferramentas
- `server/src/http/app.ts` — rotas REST, SSE `/api/stream`, uploads, `/files/deliverables/...`
- `web/src` — React; `api.ts` (fetch + SSE + `useData`), `ui.tsx` (ícones, badges, Markdown seguro), `pages/`, `components/`

## Regras do projeto

- Nunca simular execução: eventos e entregáveis só nascem de ações reais do runtime. O dublê `FakeRuntime` existe **apenas** em `server/test/helpers.ts`.
- Toda ação externa (publicar, enviar, gastar, excluir) passa por `solicitar_aprovacao`. Aprovar não executa conector nenhum enquanto o conector não existir.
- Integração só pode ficar `disponivel` no Tool Registry depois de implementada e testada; até lá, `pendente` com `howToEnable`.
- Novo agente ou skill: atualize `agents/registry.json` e o `owners` da skill; `server/test/registries.test.ts` valida a consistência (22 agentes, skills e ferramentas existentes, seções obrigatórias do SKILL.md).
- Skill nova precisa das seções `## Etapas`, `## Validação`, `## Erros`, `## Limites`.
- TypeScript estrito, sem `any` desnecessário. Interface: tokens CSS em `web/src/styles.css` (`--bg`, `--surface`, `--primary`…); sem bibliotecas de UI.
- Comandos dos agentes rodam no sandbox de SO (`runtime/sandbox.ts`); o guard não substitui isolamento. Não afrouxe `buildSandbox` sem repetir `npm run sandbox:check`.
- Restauração de backup nunca sobrescreve; retenção nunca deixa menos de 2 snapshots. Migrações de banco são só aditivas (`Db.migrate`).
- Não aumentar tetos de custo sem pedido explícito do usuário. Erro de limite da conta pausa a execução (`waitForAccount`), não consome tentativa.
- Segredos só no `.env` (não versionado). Nada sensível vai para o frontend nem para o ambiente dos agentes (`agentEnv`).
- Textos de interface e documentação em português do Brasil.
