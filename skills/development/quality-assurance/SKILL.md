---
name: quality-assurance
title: Garantia de qualidade de entregas digitais
description: Testa de verdade sites, código e vídeos produzidos pela equipe, corrige problemas objetivos e emite um laudo com evidências.
owners: [sofia]
triggers: [testar, QA, validar site, revisar entrega, verificar vídeo]
inputs: [artefato no workspace (site, código ou vídeo), requisitos do pedido]
tools: [arquivos, shell, playwright, ffmpeg, analise_imagem]
outputs: [entregas/qa/laudo-qualidade.md]
---

## Etapas
1. Identifique o artefato e os requisitos do pedido original.
2. **Site**: confira estrutura de arquivos; valide que todo `src`/`href` relativo existe; verifique `title`, meta description, `h1` único, `alt`, `lang`; procure `lorem`, `TODO` e textos de exemplo; valide links `wa.me`, `tel:` e âncoras; rode `node --check` nos arquivos JS; sirva localmente (`python3 -m http.server` em porta livre, em segundo plano, e encerre ao final) e confirme HTTP 200 nas páginas e recursos. Com navegador disponível, capture 360/768/1280 px e inspecione as imagens.
3. **Vídeo**: `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json arquivo.mp4`; confirme resolução, duração, codecs e presença de áudio conforme o pedido; extraia quadros (`ffmpeg -i v.mp4 -vf fps=1/5 quadro_%02d.jpg`) e inspecione-os.
4. **Código**: execute os testes e o build existentes; rode o programa com uma entrada real.
5. Corrija diretamente defeitos simples e objetivos (link quebrado, `alt` ausente, erro de digitação). Se a correção alterar um entregável, registre nova versão com o mesmo nome.
6. Escreva o laudo: verificação · método · resultado · evidência, e o veredito (aprovado / aprovado com ressalvas / reprovado).

## Validação
- Cada linha do laudo corresponde a um comando ou inspeção realmente executada.
- Itens não verificáveis no ambiente aparecem como "não verificado" com o motivo.

## Erros
- Servidor local não sobe: teste por leitura de arquivos e declare a limitação.
- Artefato ausente: reprove e informe exatamente o caminho esperado.

## Limites
- Não reescrever o trabalho do colega além de correções pontuais. Não testar sistemas de terceiros nem endereços fora do workspace.
