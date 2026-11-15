---
name: reels-production
title: Produção de Reels (roteiro técnico)
description: Analisa o material bruto disponível e produz um roteiro técnico de vídeo vertical curto, plano a plano, pronto para a edição executar.
owners: [leonardo, isabela]
triggers: [reels, vídeo curto, vídeo para instagram, tiktok, shorts, vídeo de 30 segundos]
inputs: [pasta de vídeos e fotos (entrada/ ou pasta local autorizada), tema, duração, identidade da marca quando houver]
tools: [arquivos, shell, ffmpeg, analise_imagem]
outputs: [entregas/video/roteiro-tecnico.md, quadros de análise em trabalho/analise/]
---

## Etapas
1. Localize o material. Procure primeiro em `entrada/`; depois nas pastas locais autorizadas (`find <pasta_autorizada> -maxdepth 4 -iname "*nome*"`). Se a pasta pedida não existir nesses locais, pare e informe exatamente onde procurou — não use outro material.
2. Inventarie cada arquivo: `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate -of csv=p=0 "arquivo"`. Monte uma tabela (arquivo, tipo, duração, resolução, orientação, tem áudio).
3. Veja o conteúdo de verdade: extraia quadros (`ffmpeg -v error -i "arquivo" -vf "fps=1/2,scale=480:-2" trabalho/analise/NOME_%02d.jpg`) e abra-os com Read. Anote por trecho: o que aparece, qualidade (foco, luz, estabilidade) e utilidade para o tema.
4. Selecione os melhores trechos para o tema pedido. Prefira movimento, close de produto, pessoas e ambiente.
5. Estruture a narrativa para a duração pedida: gancho (0–2 s, plano mais forte + texto curto) · desenvolvimento (3 a 6 planos de 2–5 s) · fechamento com chamada para ação (3–4 s). Fotos entram como planos de 2–3 s com movimento lento de zoom.
6. Escreva `entregas/video/roteiro-tecnico.md` com uma tabela: nº · arquivo · início · fim · duração · enquadramento 9:16 (centro, esquerda, direita ou coordenada) · texto na tela · observações. Some as durações e confira com a duração pedida.
7. Defina estilo dos textos (fonte disponível no sistema via `fc-list`, cor da marca, posição dentro da área segura: evite os 250 px superiores e os 420 px inferiores em 1080x1920).
8. Áudio: indique som ambiente dos clipes ou trilha **somente** se houver arquivo de música fornecido/licenciado em `entrada/`. Sem trilha autorizada, registre isso como pendência.

## Validação
- Todo plano aponta para arquivo existente e para um intervalo dentro da duração do arquivo.
- A soma das durações bate com o pedido (tolerância de 0,5 s).
- Textos na tela com até 6 palavras por plano.

## Erros
- Material insuficiente para a duração: proponha a maior duração viável ou o uso de fotos, e explique.
- Arquivo ilegível pelo ffprobe: exclua do roteiro e liste na devolutiva.

## Limites
- Acessar apenas `entrada/` e pastas autorizadas. Não baixar músicas nem vídeos da internet. Não publicar.
