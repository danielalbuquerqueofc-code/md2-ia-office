# Status — MD2 IA Office 2.0

Atualizado em 15/11/2026. Branch: `claude/md2-ia-office-reformulacao-ktmyv0`. **Não está pronto para produção exposta à internet** (ver "Antes de operar comercialmente"). Está pronto para uso pelo operador em máquina própria ou servidor privado.

## Testes executados

| Tipo | Comando | Resultado |
|---|---|---|
| Tipagem (servidor e interface) | `npm run typecheck` | Passou |
| Unitários e integração (35) | `npm test` | 35/35 passaram |
| Interface E2E — login, 9 telas × desktop/celular/tablet, rolagem horizontal, erros de console, 22 agentes | `npm run e2e` | 39/39 verificações passaram |
| Build de produção | `npm run build` | Passou |

Cobertura dos testes automatizados (runtime substituído pelo dublê `FakeRuntime`, identificado e restrito a `server/test`): resposta direta sem tarefas; paralelismo real com dependências; retentativa após falha; cancelamento de dependentes; execução marcada como falha quando nada conclui; rodada de correção pedida por Alfred; aprovação humana; retomada após queda sem refazer tarefas concluídas; idempotência por `clientRequestId`; teto de custo por execução; timeout por tarefa; runtime indisponível sem simulação; replanejamento quando Alfred escolhe agente inexistente; cancelamento; versionamento de entregáveis e ajuste como nova execução; guard de segurança (escrita, leitura, comandos bloqueados, rede interna, segredos); autenticação, CSRF, upload, path traversal, CSP sandbox, SSE e auditoria pela API.

## Execuções reais (Claude Agent SDK, sem dublê)

| Pedido | Plano criado por Alfred | Resultado | Tempo | Custo |
|---|---|---|---|---|
| Proposta comercial de tráfego pago para uma padaria | 1 tarefa (Rafael) | Proposta HTML A4 + notas de revisão; nada inventado, lacunas marcadas `[A CONFIRMAR]`; premissa ambígua (honorário × verba) sinalizada | 3 min | US$ 0,70 |
| **Fluxo B** — "encontre a pasta Pão de Mel no meu notebook… produza um Reels de 30 s" | 3 tarefas encadeadas (Leonardo → Isabela → Diego) | Pasta localizada na pasta autorizada; inventário com ffprobe e análise visual de quadros; roteiro técnico; **MP4 real 1080x1920, 30 fps, H.264+AAC, 30,0 s** (verificado de forma independente); capa, legenda, script FFmpeg reprodutível; QA encontrou e corrigiu 2 defeitos reais (cortes 1 quadro atrasados, fade final) e gerou a v2 | 13 min | US$ 2,36 |
| **Fluxo A** — site profissional para uma oficina mecânica (briefing + logo, sem links) | 6 tarefas (Mariana → Beatriz → Pedro ∥ Camila → Bruno → Diego) | Pesquisa com concorrentes reais da cidade; estratégia; textos; especificação de UI; **site estático completo** (SEO, Open Graph, JSON-LD, robots, sitemap, 17 links de WhatsApp por serviço, menu móvel, animações com fallback sem JS); sem erros de console, sem rolagem horizontal, um `h1`, todas as imagens com `alt` (verificado de forma independente); avaliações, mapa e endereço deixados como espaços reservados explícitos em vez de inventados | 34 min | US$ 9,22 |

Observação honesta: no fluxo B, o material de entrada era **sintético** (clipes e fotos gerados por FFmpeg com rótulos), porque não há material real do cliente neste ambiente. O agente percebeu e relatou isso. O pipeline (localizar, analisar, roteirizar, editar, exportar, validar) é real; a qualidade estética final depende do material real.

## Pendências que dependem de você

| Item | O que falta |
|---|---|
| Credencial do runtime | `ANTHROPIC_API_KEY` no `.env` ou login do Claude Code na máquina que roda o servidor. |
| Nomes dos 12 agentes provisórios | Cadastro original não estava no repositório. Edite `agents/registry.json` (ver `docs/DIAGNOSTICO.md`). |
| Pastas locais | Defina `MD2_AUTHORIZED_DIRS` com as pastas de clientes que os agentes podem ler. |
| Instagram (publicação e métricas) | Conta profissional + app Meta com `instagram_content_publish` aprovado + `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_BUSINESS_ACCOUNT_ID`. **O conector ainda não foi implementado.** Hoje, aprovar uma publicação registra a decisão, mas não publica. |
| Google Drive e Calendar | Cliente OAuth no Google Cloud + `GOOGLE_OAUTH_*`. Conector não implementado. |
| GitHub | `GITHUB_TOKEN`. Push e PR continuam bloqueados pelo guard até existir fluxo de aprovação com execução. |
| Geração de imagens | Escolher provedor + `IMAGE_GENERATION_API_KEY`. Conector não implementado; os agentes usam imagens do cliente ou composições próprias em CSS/SVG. |
| Transcrição de fala para legendas | Instalar `openai-whisper` no servidor. Sem ele, as legendas saem do roteiro. |
| Navegador automatizado (Playwright MCP) | `MD2_ENABLE_PLAYWRIGHT_MCP=1` em máquina com Chromium. Não testado com agentes neste ambiente. |
| Instagram e Google Maps sem API | Páginas que exigem login podem não ser legíveis pela leitura web; o agente declara a limitação e pede capturas de tela. |

## Antes de operar comercialmente

1. **Isolamento de execução**: rode o servidor em contêiner ou usuário de sistema dedicado com escrita apenas em `MD2_DATA_DIR`. O guard é defesa em profundidade, não isolamento (ver `docs/ARQUITETURA.md`).
2. **Conectores de publicação** (Instagram, e-mail, WhatsApp Business) ligados ao Centro de Aprovações, para que "aprovar" execute a ação com registro.
3. **Multiusuário** (equipe ou clientes acessando): hoje o acesso é de um único administrador.
4. **Backup** do diretório `data/` (banco + entregáveis) e monitoramento do processo (systemd/pm2 + alerta).
5. **Hospedagem de prévias** com link compartilhável para o cliente final aprovar (hoje a prévia fica dentro do sistema).
6. **Calibrar custos e modelos por tipo de tarefa** com base nos custos reais acima (ex.: modelo mais econômico para pesquisa e QA).
