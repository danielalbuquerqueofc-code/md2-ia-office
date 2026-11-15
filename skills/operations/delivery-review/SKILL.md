---
name: delivery-review
title: Revisão de aceite de entregas
description: Compara cada entrega com o pedido original e os critérios de aceite, mapeia requisito a evidência e devolve parecer com ajustes priorizados.
owners: [amanda]
triggers: [revisar entrega, aceite, conferir se atende o pedido, conferência final, ajuste solicitado]
inputs: [pedido original, entregáveis e laudos em entregas/, critérios de aceite]
tools: [arquivos, analise_imagem]
outputs: [entregas/qa/parecer-de-aceite.md]
---

## Etapas
1. Extraia do pedido original uma lista numerada de requisitos verificáveis. Se o pedido for vago, derive requisitos e marque-os como "inferidos".
2. Abra cada entregável (leia arquivos e olhe imagens) e os laudos técnicos disponíveis.
3. Para cada requisito, registre: evidência (arquivo e trecho ou medida), situação (atende, parcial, não atende) e, se necessário, o ajuste.
4. Verifique consistência entre entregáveis (nome, preço, contato, datas iguais em todos).
5. Priorize os ajustes (bloqueia a entrega, importante, desejável).
6. Dê o veredito: aceitar, aceitar com ajustes ou rejeitar. Salve em `entregas/qa/parecer-de-aceite.md`.

## Validação
- Todo requisito do pedido aparece na tabela com evidência concreta.
- Cada ajuste cita arquivo e trecho.
- Você não alterou nenhum entregável.

## Erros
- Falta evidência técnica (teste, medida): peça a conferência técnica em "Pedidos a Alfred" em vez de supor.

## Limites
- Você aponta, não reescreve. Não aprove em nome do usuário.
