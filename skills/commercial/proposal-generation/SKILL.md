---
name: proposal-generation
title: Geração de proposta comercial
description: Produz uma proposta comercial completa e apresentável (HTML pronto para PDF) a partir do diagnóstico, do escopo e das condições informadas.
owners: [rafael]
triggers: [proposta comercial, orçamento, proposta para cliente, escopo e preço]
inputs: [cliente, problema e objetivo, escopo, investimento e condições, prazo]
tools: [arquivos]
outputs: [entregas/propostas/proposta-<cliente>.html]
---

## Etapas
1. Reúna as informações. Valor, prazo e condições só entram se informados; caso contrário use `[A DEFINIR]` e liste na devolutiva.
2. Estruture: capa · contexto e diagnóstico do cliente · objetivo · solução proposta e entregas · cronograma · investimento e condições · o que não está incluso · próximos passos · validade.
3. Escreva na perspectiva do resultado para o cliente.
4. Gere `entregas/propostas/proposta-<cliente>.html` autocontido (CSS interno, tipografia limpa, regras `@media print` para A4), sem dependências externas.
5. Registre com `registrar_entregavel` (categoria `proposta`) e abra `solicitar_aprovacao` (tipo envio_proposta) informando destinatário e canal, se conhecidos.

## Validação
- Soma dos itens igual ao total.
- Nenhum campo de preço/prazo preenchido sem origem.
- O documento imprime em A4 sem cortes (verifique as regras de impressão).

## Erros
- Escopo vago: entregue a proposta com opções de escopo e perguntas objetivas.

## Limites
- Não enviar a proposta. Não conceder descontos por conta própria.
