# Piloto comercial (interno)

`Md2CommercialPilot` (`server/src/md2/pilot.ts`) organiza o funil comercial **dentro** do MD2.
Não envia mensagens, não marca reuniões, não faz scraping, não chama IA e não ativa agentes.

## Papéis (conforme o cadastro dos 22 agentes)

| Agente   | Papel no piloto                                        |
| -------- | ------------------------------------------------------ |
| Carlos   | Coordena: classificação, recomendação e acompanhamento |
| Lucas    | Prospecção: registro e primeiro contato (rascunho)     |
| Fernanda | Qualificação: perguntas de qualificação (rascunho)     |
| Rafael   | Propostas: minuta de proposta (rascunho)               |

O pedido original citava "Fernanda propostas" e "Rafael acompanhamento"; o cadastro define
Fernanda como qualificação e Rafael como propostas. O cadastro foi preservado.

## Fluxo

1. `POST /api/md2/pilot/leads` — o operador registra o lead com uma referência única
   (repetir a referência devolve o mesmo lead). Campos: empresa (obrigatório), nome, cargo,
   segmento, origem (`manual`, `indicacao`, `evento`, `inbound`, `base-propria`), necessidade e
   observações. **E-mail, telefone e segredos são recusados** (`PILOT_SENSITIVE_DATA`): dados de
   contato ficam no CRM do operador.
2. `POST /pilot/leads/:id/classify` — regras determinísticas: cargo decisor (+2), necessidade
   descrita (+2), origem qualificada (+1), segmento (+1), empresa (+1). `hot` ≥ 5 → Rafael;
   `warm` ≥ 3 → Fernanda; `cold` → Lucas.
3. `POST /pilot/leads/:id/messages` (`first-contact`, `qualification`, `proposal`, `follow-up`) —
   rascunho por modelo de texto, sempre `status: draft` e `sendable: false`. Não existe rota de
   envio; uma pessoa revisa e envia fora do sistema.
4. `POST /pilot/leads/:id/actions` e `.../actions/:actionId/complete` — próximas ações internas
   (título, responsável entre os quatro agentes, data `AAAA-MM-DD`).
5. `GET /pilot/leads` e `GET /pilot/leads/:id` — visão consolidada.

Permissões: escrita exige `queue.operate`; leitura, `queue.read`. Tudo fica no armazenamento do
cliente/projeto da sessão, como tarefas `lead-*` e eventos imutáveis `pilot-*`.

## Próximo passo (com autorização)

Para análises por IA de um lead, registre uma demanda (`POST /demands` com intenção
`commercial.prospect`, `commercial.qualify` ou `commercial.proposal`), enfileire e aprove a ação
exata. A execução real só acontece com `MD2_WORKER=codex` e autorização separada.
