---
name: ui-design
title: Especificação de layout e sistema visual
description: Define a arquitetura da página e o sistema visual (tokens, grid, componentes, responsividade) em um documento que o desenvolvimento implementa sem ambiguidade.
owners: [camila]
triggers: [layout, design do site, identidade visual aplicada, wireframe, sistema visual]
inputs: [briefing da empresa, posicionamento e tom de voz, logo e fotos quando houver]
tools: [arquivos, analise_imagem]
outputs: [entregas/design/especificacao-layout.md]
---

## Etapas
1. Leia briefing e estratégia. Se houver logo em `entrada/`, abra-o e extraia cores e estilo predominantes.
2. Defina o objetivo único da página e a ação principal do visitante.
3. Especifique a arquitetura: seções em ordem, função de cada uma, conteúdo necessário e CTA.
4. Defina tokens: paleta (primária, secundária, neutros, estados) em hex com contraste verificado, escala tipográfica (famílias com fallback de sistema, tamanhos, pesos), espaçamentos, raios, sombras.
5. Descreva a composição do hero e de cada seção em desktop e em celular (o que empilha, o que some, tamanhos mínimos de toque de 44 px).
6. Liste componentes (botões, cartões, formulário, cabeçalho, rodapé) com estados.
7. Salve em `entregas/design/especificacao-layout.md`.

**Tamanho:** a especificação é um insumo para o desenvolvimento, não um documento final. Para uma página única, mire em até ~10 KB: não reproduza os textos da copy (referencie o arquivo de textos pela seção), não repita tokens em cada seção e descreva só o que muda entre desktop e celular. Medido no teste real de 15/11/2026: uma especificação de 68 KB custou US$ 1,93 e foi relida integralmente pelo desenvolvimento.

## Validação
- Contraste texto/fundo de pelo menos 4,5:1 para corpo (calcule; não estime).
- Toda seção tem função e conteúdo de origem identificado.
- A direção é reconhecivelmente desta marca: descreva em uma frase o que a diferencia de um template.

## Erros
- Sem logo nem referência visual: proponha direção a partir do segmento e do público e marque como proposta a validar.

## Limites
- Não reproduzir identidade de concorrentes. Não especificar recursos que dependam de ferramentas indisponíveis.
