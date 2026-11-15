# Diagnóstico das integrações

Classificação por evidência, em 15/11/2026. "Funcional e testada" exige uso real registrado; ter interface ou variável de ambiente não basta. A mesma classificação aparece na tela Ferramentas.

| Integração | Classificação | Evidência | O que falta |
|---|---|---|---|
| **Claude API / Claude Agent SDK** (runtime de Alfred e dos agentes) | **Funcional e testada** | Execuções reais de proposta, site, Reels, landing page e recuperação após queda; saída estruturada do Alfred; sessões retomáveis; custo por execução; sandbox de SO testado. | Configurar `ANTHROPIC_API_KEY` (ou login do Claude Code) na máquina de produção. |
| **Claude Code** (ambiente de desenvolvimento) | **Funcional e testada** | O projeto é desenvolvido e testado com ele; o runtime é o próprio Claude Code empacotado (Agent SDK). | — |
| **Ferramentas de edição de vídeo (FFmpeg)** | **Funcional e testada — com ressalva** | Corte, recorte 9:16, textos, normalização de áudio, exportação H.264/AAC executados por agentes e conferidos com ffprobe. | **Validado apenas com material sintético** (gerado por FFmpeg). Não foi possível testar com filmagens reais: não há vídeo real no ambiente e a política de rede bloqueia acervos públicos (Wikimedia, Pexels, Archive.org). Validar com uma pasta real de cliente. |
| **Análise de imagem** | **Funcional e testada** | Agentes leram logo enviada e quadros extraídos de vídeo. | — |
| **Pesquisa web** | **Funcional e testada** | Pesquisa de concorrentes reais em Sorocaba no fluxo do site. | Páginas com login (Instagram, partes do Google Maps) não são legíveis sem API. |
| **Playwright (navegador via MCP)** | **Configurada, mas não testada** | Código conecta `@playwright/mcp` quando `MD2_ENABLE_PLAYWRIGHT_MCP=1`. Não foi exercitado por um agente. | Teste real com Chromium; validar dentro do sandbox. |
| **Transcrição (whisper)** | **Parcialmente implementada** | Prevista na skill de edição; detecção do binário pronta. | Instalar `openai-whisper` no servidor e testar legendas a partir da fala. |
| **WhatsApp** | **Parcialmente implementada** | Sites gerados usam links `wa.me` com mensagem pré-preenchida (testado: 17 links funcionais no site da oficina). | Envio de mensagens não existe. Exige WhatsApp Business Platform (Cloud API): conta Meta Business verificada, número dedicado, modelos aprovados, token. Conector ligado ao centro de aprovações. |
| **GitHub** | **Não implementada** | Sem conector; `git push`/`gh pr` bloqueados pelo guard. | `GITHUB_TOKEN` de escopo mínimo + conector cujas ações (push, PR) só executem após aprovação. |
| **Google Drive** | **Não implementada** | Sem conector. | Cliente OAuth no Google Cloud (Drive API), `GOOGLE_OAUTH_CLIENT_ID/SECRET/REFRESH_TOKEN`, conector de leitura com escopo restrito. |
| **Google Calendar** | **Não implementada** | Sem conector. | Mesmo OAuth com Calendar API; criação de evento com convidados sujeita a aprovação. |
| **Instagram** | **Não implementada** | Sem conector. Aprovar uma publicação registra a decisão, mas **não publica**. | Conta profissional vinculada a Página do Facebook, app Meta com `instagram_content_publish` aprovado na revisão da Meta, `INSTAGRAM_ACCESS_TOKEN` e `INSTAGRAM_BUSINESS_ACCOUNT_ID`; conector que publique somente após aprovação. |
| **Geração de imagens** | **Não implementada** | Sem provedor nem conector. Agentes usam imagens do cliente ou composições em CSS/SVG. | Escolher provedor, `IMAGE_GENERATION_API_KEY`, conector e política de uso de imagens. |

## Melhorias internas feitas nesta etapa (sem credenciais)

- Classificação por evidência no Tool Registry (`classification` + `evidence`), exibida na interface e em `docs/AGENTES.md`.
- WhatsApp incluído no registro com a distinção entre link (existe) e envio (não existe).
- Integração externa nunca aparece como disponível sem conector implementado e testado (regra coberta por teste).
- Aprovações já registram a decisão com auditoria; quando um conector existir, ele deve ser acionado **somente** a partir de uma aprovação `aprovado`.

## Ordem sugerida de implementação

1. **Instagram** (publicação + métricas) ligado ao centro de aprovações — maior ganho operacional para o modelo de negócio.
2. **WhatsApp Business** para envio de propostas e follow-up, também com aprovação.
3. **Google Drive** (leitura de materiais do cliente) — substitui o upload manual.
4. **Playwright** dentro do sandbox, para QA visual automático dos sites.
