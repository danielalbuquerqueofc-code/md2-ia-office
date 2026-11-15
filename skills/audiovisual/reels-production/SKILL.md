---
name: reels-production
title: Roteiro técnico de Reels
description: Lê o inventário e as folhas de contato do material e escreve o roteiro técnico plano a plano, a legenda e a avaliação honesta do material para um vídeo vertical curto.
owners: [isabela]
triggers: [reels, vídeo curto, roteiro de vídeo, legenda de reels, vídeo de 30 segundos]
inputs: [entregas/video/inventario.md, folhas de contato em trabalho/analise/, tema, duração e identidade da marca]
tools: [arquivos, web, analise_imagem]
outputs: [entregas/video/roteiro-tecnico.md, entregas/video/legenda.txt]
---

## Etapas
1. Leia `entregas/video/inventario.md` e abra com Read as folhas de contato. Se o inventário não existir, não o improvise: registre em "Pedidos a Alfred" que o Diego precisa produzi-lo.
2. Avalie cada arquivo de 1 a 5 para o tema: foco, luz, estabilidade, ação e utilidade narrativa, com a razão. Diga com franqueza se o material **não serve para publicação** e por quê (por exemplo, indícios de material sintético apontados no inventário).
3. Selecione os melhores trechos e monte a narrativa para a duração pedida: gancho (0–2 s, plano mais forte com texto curto), desenvolvimento (3 a 6 planos de 2–5 s) e fechamento com chamada para ação (3–4 s). Fotos entram como planos de 2–3 s com zoom lento.
4. Escreva `entregas/video/roteiro-tecnico.md`: tabela com nº, caminho absoluto do arquivo, início, fim, duração, enquadramento 9:16 (centro, esquerda, direita), texto na tela e observações. Some as durações e confira com o pedido.
5. Defina o estilo dos textos: cor da marca, posição dentro da área segura (evite os 250 px superiores e os 420 px inferiores em 1080x1920) e no máximo 6 palavras por plano.
6. Áudio: use o som dos clipes ou uma trilha **somente** se houver arquivo licenciado fornecido. Sem trilha autorizada, registre a pendência.
7. Escreva `entregas/video/legenda.txt` (gancho na primeira linha, blocos curtos, chamada para ação, até 8 hashtags) e indique o quadro da capa (plano e tempo).

## Validação
- Cada plano aponta para arquivo que consta no inventário e para um intervalo dentro da duração dele.
- A soma das durações bate com o pedido (tolerância de 0,5 s).
- Nenhum plano usa trecho marcado como preto, congelado ou inutilizável no inventário.
- A avaliação do material é franca e cita fatos do inventário.

## Erros
- Material insuficiente para a duração pedida: proponha a maior duração viável ou o uso de fotos e explique.
- Material impróprio para publicação: entregue o roteiro como teste de edição, diga isso no topo e liste o que o cliente precisa gravar.

## Limites
- Você não executa comandos: trabalha só com o inventário e as imagens.
- Sem música sem licença. Sem publicação: a prévia aguarda aprovação.
- Não invente cenas que não existem no material.
