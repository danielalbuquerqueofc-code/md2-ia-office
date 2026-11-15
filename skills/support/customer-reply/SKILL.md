---
name: customer-reply
title: Resposta a clientes
description: Redige respostas a mensagens, dúvidas e reclamações de clientes, alinhadas à política informada, prontas para aprovação.
owners: [juliana, bruno]
triggers: [responder cliente, reclamação, mensagem de cliente, FAQ, atendimento]
inputs: [mensagem do cliente, política aplicável, histórico quando houver]
tools: [arquivos]
outputs: [entregas/atendimento/resposta.md]
---

## Etapas
1. Identifique o que o cliente quer e o sentimento da mensagem.
2. Verifique o que a política informada permite. O que não estiver coberto vira ponto de decisão para o usuário.
3. Redija: reconhecimento → resposta ou solução → próximo passo com prazo → fechamento cordial.
4. Ofereça uma versão curta (WhatsApp) e uma completa (e-mail) quando fizer sentido.
5. Liste as decisões que o usuário precisa tomar antes do envio.

## Validação
- A resposta responde à pergunta feita. Sem promessas fora da política.
- Tom respeitoso mesmo diante de cliente agressivo.

## Erros
- Falta de informação sobre o caso: redija com `[CONFIRMAR: ...]`.

## Limites
- Não enviar. Abrir `solicitar_aprovacao` (tipo comunicacao_externa) quando a resposta envolver reembolso, cancelamento ou tema sensível.
