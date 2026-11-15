# MD2 IA Office

Central de comando empresarial. Você conversa com **Alfred**, o diretor de operações de IA. Ele interpreta o pedido, monta o plano, distribui o trabalho entre **22 agentes especializados**, acompanha a execução em tempo real, valida os resultados e entrega arquivos reais para você aprovar.

> O usuário dá a ordem, Alfred coordena, os agentes executam e o sistema entrega. Nada é publicado, enviado ou gasto sem a sua aprovação.

## Como iniciar

Requisitos: **Node.js 22.13 ou superior** (usa o SQLite nativo do Node), **FFmpeg** no PATH para o fluxo de vídeo e, no Linux, **bubblewrap e socat** para isolar os comandos dos agentes (`sudo apt-get install -y bubblewrap socat`).

```bash
npm install
```

```bash
cp .env.example .env
```

Configure o acesso ao Claude no `.env`: **uma** das opções abaixo.
- `ANTHROPIC_API_KEY=` com uma chave da Anthropic; ou
- deixe vazio e faça login uma vez no Claude Code nesta máquina (`claude`, depois `/login`). O runtime usa essa credencial.

Desenvolvimento (servidor + interface com recarga automática, em http://localhost:5173):

```bash
npm run dev
```

Produção (um único processo, em http://127.0.0.1:4310):

```bash
npm run build
```

```bash
npm start
```

Para manter o serviço rodando 24 horas, execute `npm start` sob um gerenciador de processos (systemd, pm2, Docker com `restart: always`). Ao reiniciar, execuções interrompidas são retomadas automaticamente a partir das tarefas já concluídas.

### Variáveis principais (`.env`)

| Variável | Para quê | Padrão |
|---|---|---|
| `ANTHROPIC_API_KEY` | Credencial do runtime (ou login do Claude Code) | — |
| `MD2_HOST` / `MD2_PORT` | Endereço do servidor. Fora de `127.0.0.1` exige senha | `127.0.0.1` / `4310` |
| `MD2_ADMIN_PASSWORD` | Senha de acesso à interface | vazio (somente local) |
| `MD2_DATA_DIR` | Banco SQLite, workspaces, uploads e entregáveis | `./data` |
| `MD2_AUTHORIZED_DIRS` | Pastas locais que os agentes podem **ler** (ex.: sua pasta de clientes) | nenhuma |
| `MD2_MAX_COST_USD_PER_EXECUTION` / `_PER_DAY` | Teto de gasto (um site completo custou ~US$ 9 no teste real) | 15 / 60 |
| `MD2_MAX_PARALLEL_TASKS` / `_EXECUTIONS` | Concorrência | 3 / 2 |
| `MD2_TASK_TIMEOUT_MIN`, `MD2_TASK_MAX_ATTEMPTS` | Tempo limite e tentativas por tarefa | 25 / 2 |
| `MD2_MODEL_ALFRED`, `MD2_MODEL_AGENTS` | Modelo de cada camada | padrão da conta |
| `MD2_ENABLE_PLAYWRIGHT_MCP` | Navegador automatizado para pesquisa e QA visual | `0` |
| `MD2_MAX_COST_USD_PER_TASK` | Teto por tarefa de agente | 5 |
| `MD2_AGENT_SANDBOX` | Isolamento dos comandos dos agentes: `auto`, `required`, `off` | `auto` |
| `MD2_MAX_RECOVERIES` | Retomadas automáticas de uma execução após reinício | 2 |
| `MD2_BACKUP_DIR` / `_INTERVAL_HOURS` / `_KEEP` | Backup automático verificado | `./backups` / 6 / 14 |
| `MD2_ALLOWED_HOSTS` | Hosts extras aceitos (domínio atrás de proxy) | — |

## O que o sistema faz hoje

- **Central de Comando**: conversa com Alfred por texto, voz (ditado do navegador; Chrome/Edge) e anexos (imagens, vídeos, PDFs, documentos). Execução acompanhada ao vivo: etapas, agente responsável, atividade de cada agente, erros, custo.
- **Alfred**: decide entre responder direto ou planejar; divide em tarefas com dependências; roda tarefas independentes em paralelo; tenta de novo em falhas; valida e pode pedir uma correção; consolida a devolutiva relatando com fidelidade o que falhou.
- **22 agentes** em 10 departamentos, cada um com identidade, instruções permanentes, limites, critérios de qualidade, skills, ferramentas e bibliotecas de conhecimento (`agents/registry.json`).
- **Knowledge Engine**: 15 documentos por departamento em `knowledge/`, com busca por relevância.
- **Skill Registry**: 17 skills executáveis no formato `SKILL.md` em `skills/`, incluindo construção de sites e edição de vídeo com FFmpeg.
- **Tool Registry**: ferramentas com status real (disponível / pendente / indisponível) e instruções de ativação.
- **Entregáveis**: prévia de sites (desktop, tablet e celular), vídeos, imagens, PDFs e textos; histórico de versões imutáveis; aprovar ou pedir ajustes (que viram nova execução na mesma conversa).
- **Aprovações**: publicações, envios externos, gastos, contratações, alterações financeiras e exclusões ficam aguardando a sua decisão.
- **Histórico e auditoria** de todas as decisões humanas.

## Estrutura

```
agents/registry.json        22 agentes e departamentos
knowledge/<departamento>/    bibliotecas de conhecimento (Markdown)
skills/<área>/<skill>/       skills executáveis (SKILL.md)
server/src/                  servidor: API, Alfred, runtime, registros, banco
server/test/                 testes (Vitest)
web/src/                     interface (React + Vite)
e2e/ui-smoke.mjs             teste de interface (Playwright)
docs/                        diagnóstico, arquitetura e status
legacy/pixel-agents/         versão anterior do repositório, preservada
```

## Testes

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build && npm run e2e
```

Teste real de ponta a ponta (consome créditos da conta Claude):

```bash
npm run smoke:runtime -- "Alfred, prepare uma proposta comercial para ..."
```

Backup e restauração: [docs/BACKUP_E_RECUPERACAO.md](docs/BACKUP_E_RECUPERACAO.md). Segurança: [docs/SEGURANCA.md](docs/SEGURANCA.md). Integrações: [docs/INTEGRACOES.md](docs/INTEGRACOES.md). Agentes: [docs/AGENTES.md](docs/AGENTES.md), [originais e confirmados](docs/AGENTES_ORIGINAIS_E_CONFIRMADOS.md), [matriz de competências](docs/MATRIZ_DE_COMPETENCIAS.md). Alfred: [docs/ALFRED_ORQUESTRADOR.md](docs/ALFRED_ORQUESTRADOR.md). Validação com material real: [docs/PLANO_VALIDACAO_REAL.md](docs/PLANO_VALIDACAO_REAL.md). Fase 2: [docs/FASE_2_RELATORIO.md](docs/FASE_2_RELATORIO.md).

Comandos da fase 2 (sem custo, exceto `plan:preview`): `npm run preflight -- --cenario b --pasta "/caminho"` mede o material antes de gastar; `npm run plan:preview -- "<pedido>"` mostra o plano de Alfred sem executar (US$ 0,10 a 0,40); `npm run sandbox:check` testa o isolamento com um agente real (pago).

Status detalhado, resultados de testes e pendências: [docs/STATUS.md](docs/STATUS.md). Arquitetura: [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Estado anterior do repositório: [docs/DIAGNOSTICO.md](docs/DIAGNOSTICO.md).
