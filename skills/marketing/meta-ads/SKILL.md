---
name: meta-ads
title: Planejamento de campanhas Meta Ads
description: Estrutura um plano de campanha no Meta Ads para geração de clientes, com públicos, orçamento, criativos necessários, textos e método de leitura dos resultados.
owners: [gabriel]
triggers: [meta ads, tráfego pago, anúncios no instagram, campanha de leads, facebook ads]
inputs: [objetivo, oferta, região, orçamento mensal, ativos disponíveis (página, pixel, criativos)]
tools: [arquivos, web]
outputs: [entregas/campanhas/plano-meta-ads.md]
---

## Etapas
1. Confirme objetivo de negócio, oferta, região de atendimento e orçamento. Sem orçamento informado, apresente três faixas e marque como a definir.
2. Escolha o objetivo de campanha coerente com o destino da conversão (mensagens no WhatsApp, formulário instantâneo ou site com evento de conversão) e explique a escolha.
3. Estruture: campanhas → conjuntos (público, posicionamentos, orçamento diário) → anúncios (formato, criativo, texto, CTA). Comece simples: poucos conjuntos com público amplo local e criativos variados; evite fragmentar orçamento pequeno.
4. Liste os criativos necessários com roteiro/descrição e os textos (use a skill copywriting se atribuída).
5. Mensuração: eventos a acompanhar, o que conferir antes de ativar (pixel/API de conversões, número do WhatsApp, política de anúncios da categoria).
6. Plano de leitura: métricas por etapa (alcance, CTR, custo por conversa/lead, taxa de resposta, vendas), período mínimo de aprendizado antes de mexer e gatilhos de decisão.
7. Salve em `entregas/campanhas/plano-meta-ads.md` e abra `solicitar_aprovacao` (tipo gasto) descrevendo orçamento e período, pois ativar campanha envolve gasto.

## Validação
- Orçamento diário × dias = orçamento mensal informado.
- Cada campanha tem métrica de sucesso e destino de conversão definidos.
- Nenhuma estimativa de custo por resultado apresentada como garantia.

## Erros
- Categoria com restrição de anúncios (saúde, crédito, emprego, moradia): sinalize as limitações de segmentação e de alegações e peça validação das regras vigentes na Central de Ajuda da Meta.

## Limites
- Não criar nem editar campanhas em contas reais. A integração com a conta de anúncios não está conectada nesta versão.
