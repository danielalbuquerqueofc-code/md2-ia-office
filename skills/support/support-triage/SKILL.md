---
name: support-triage
title: Triagem de solicitações de suporte
description: Classifica cada solicitação de cliente por tipo, urgência e sentimento, confronta com a política informada e define o encaminhamento, produzindo também a base de perguntas frequentes.
owners: [juliana]
triggers: [triagem, classificar solicitações, fila de suporte, faq, perguntas frequentes, reclamações em lote]
inputs: [mensagens ou tickets em entrada/, política de atendimento informada]
tools: [arquivos]
outputs: [entregas/atendimento/triagem.md, entregas/atendimento/faq.md]
---

## Etapas
1. Leia todas as solicitações e a política informada. Sem política, trabalhe só com o que as mensagens permitem e marque cada ponto como "sem política".
2. Classifique cada solicitação: tipo (dúvida, pedido, reclamação, cobrança, cancelamento, outro), urgência (alta, normal, baixa, com o motivo) e sentimento.
3. Para cada uma, diga se a política cobre o caso. Os não cobertos viram **decisão humana pendente**.
4. Defina o encaminhamento: responder agora (rascunho com a skill `customer-reply`), pedir dado ao cliente, ou escalar (contrato e LGPD para o jurídico, cobrança para o financeiro, relacionamento para o acompanhamento).
5. Agrupe perguntas repetidas e escreva a FAQ com resposta curta e a condição em que ela vale.
6. Salve `entregas/atendimento/triagem.md` (tabela) e `entregas/atendimento/faq.md`.

## Validação
- Toda solicitação recebida aparece na tabela, sem exceção.
- Cada classificação de urgência tem motivo; cada caso fora da política consta como decisão pendente.
- A FAQ só afirma o que a política informada permite.

## Erros
- Mensagem ambígua: classifique como "esclarecer" e escreva a pergunta que falta fazer ao cliente.

## Limites
- Não responda ao cliente nem conceda reembolso, desconto ou compromisso. Respostas saem como rascunho para aprovação.
