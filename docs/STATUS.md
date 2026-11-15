# Status — MD2 IA Office 2.0

Atualizado em 15/11/2026, após a operação noturna de consolidação. Branch: `claude/md2-ia-office-reformulacao-ktmyv0`. A `main` não foi alterada; não houve merge, deploy nem publicação.

**Situação:** pronto para uso pelo operador em máquina própria ou servidor privado Linux, com isolamento dos agentes, backup e recuperação testados. **Ainda não está pronto para operação comercial exposta à internet** (ver "Riscos abertos" e "Antes de operar comercialmente"). Relatório detalhado da noite: `docs/RELATORIO_OPERACAO_NOTURNA.md`.

## Testes automatizados

| Tipo | Comando | Resultado |
|---|---|---|
| Tipagem (servidor e interface) | `npm run typecheck` | Passou |
| Unitários e integração | `npm test` | 63/63 passaram (7 arquivos) |
| Interface E2E — login, 9 telas × desktop/celular/tablet, rolagem horizontal, erros de console, 22 agentes | `npm run e2e` | 39/39 verificações passaram |
| Build de produção | `npm run build` | Passou |
| Dependências vulneráveis | `npm audit` | 0 vulnerabilidades (antes: 3, sendo 2 críticas, em dependências de desenvolvimento) |

O runtime é substituído pelo dublê `FakeRuntime` apenas nesses testes (restrito a `server/test`). Cobertura acrescentada na operação noturna: sandbox (detecção e configuração), links simbólicos, rede do sandbox, credenciais no shell, mascaramento de segredos nos logs, backup/verificação/corrupção/retenção/restauração, recuperação com limites, custo de sessão retomada, limite por tarefa, uso de tokens, auditoria de bloqueios, anexos com nome repetido, ajuste duplicado, pausa por limite de uso da conta, Host/Origin, URL malformada, health público × detalhado, custos e backups pela API.

## Execuções reais (Claude Agent SDK, sem dublê)

Roteiro `e2e/real-operation.mjs`: servidor real, pedido pela API, sem navegador.

| Teste | O que foi verificado | Resultado | Custo |
|---|---|---|---|
| **Queda e retomada** — proposta comercial + plano de mídia em paralelo, com pedido de envio | Servidor derrubado com `SIGKILL` com 2 tarefas em paralelo; reinício; retomada das sessões salvas; 3 tarefas concluídas; 2 entregáveis com prévia; 2 pedidos de aprovação abertos pelos agentes (envio de proposta e gasto); aprovação registrada **sem executar nada**; segunda decisão recusada; auditoria; reenvio duplicado ignorado | **17/18** — a verificação reprovada foi "sandbox ativo": este teste rodou antes da correção da detecção do socat | US$ 1,61 |
| **Landing page com sandbox ativo** | Bruno construiu, Diego testou em 4 larguras com Chrome headless, corrigiu e gerou v2 + laudo; prévia servida | **11/12** — reprovada só "tarefas em paralelo", não aplicável (plano sequencial) | US$ 1,54 |
| **Reels com sandbox ativo e pasta autorizada** | ver `docs/RELATORIO_OPERACAO_NOTURNA.md` | ver relatório | ver relatório |
| Landing page e Reels (primeira tentativa) | A conta Claude atingiu o limite de uso de 5 horas no meio. O sistema registrou as falhas, cancelou dependentes e não marcou nada como entregue. **Falharam** — e motivaram a pausa automática por limite de conta | Falharam (causa externa) | US$ 0,54 |

Execuções da etapa anterior (antes do sandbox), mantidas como referência: proposta (US$ 0,70), site completo com 6 agentes (US$ 9,22), Reels (US$ 2,36).

### O que NÃO foi validado

- **Edição de vídeo com filmagens reais.** Todos os testes de Reels usaram material sintético gerado por FFmpeg. Não há vídeo real no ambiente e a política de rede bloqueia acervos públicos. O pipeline (localizar, inspecionar, roteirizar, cortar, exportar, validar) é real; a qualidade com material de cliente não foi medida.
- **Site completo (6 agentes) com sandbox ativo**: validado com sandbox apenas na landing page (2 agentes).
- Sandbox em macOS e Windows; Playwright MCP usado por um agente; transcrição por whisper.

## Riscos abertos

1. Processo servidor não isolado (contêiner/usuário dedicado recomendados; não testados aqui).
2. `/tmp` gravável dentro do sandbox; ferramentas de arquivo do runtime protegidas pelo guard (aplicação), não pelo sandbox.
3. Usuário único, sem perfis de acesso.
4. Nenhum conector externo: aprovar não publica nem envia.
5. Backup no mesmo disco por padrão; configurar `MD2_BACKUP_DIR` externo.
6. 12 agentes com nome provisório e 21 com função não confirmada contra o cadastro original (`docs/AGENTES.md`).
7. Limite de uso da conta Claude interrompe o trabalho; o sistema agora pausa e retoma, mas o prazo depende do plano contratado.

## Pendências que dependem de você

| Item | O que falta |
|---|---|
| Credencial do runtime | `ANTHROPIC_API_KEY` no `.env` ou login do Claude Code na máquina do servidor. |
| Cadastro original dos agentes | Fornecer nomes e funções reais; editar `agents/registry.json`. |
| Pastas locais | `MD2_AUTHORIZED_DIRS` com as pastas de clientes. |
| Material real de vídeo | Uma pasta de cliente para validar a edição. |
| Local de backup externo | `MD2_BACKUP_DIR` em outro disco ou pasta sincronizada. |
| Integrações | Credenciais e decisão de prioridade: ver `docs/INTEGRACOES.md`. |
| Isolamento no servidor de produção | Instalar `bubblewrap` e `socat` e definir `MD2_AGENT_SANDBOX=required`. |

## Antes de operar comercialmente

1. Servidor em contêiner ou usuário dedicado, com `MD2_AGENT_SANDBOX=required`, senha, HTTPS e backup externo.
2. Conector do Instagram (e depois WhatsApp Business) ligado ao centro de aprovações.
3. Validação da edição de vídeo e do site completo com material real de um cliente.
4. Link de prévia compartilhável para o cliente final aprovar.
5. Acesso multiusuário.
6. Calibração de modelos por tipo de tarefa (pesquisa e QA em modelo mais econômico) com base nos custos medidos.
