---
name: video-editing
title: Edição de vídeo com FFmpeg
description: Executa a edição real de um vídeo vertical a partir de roteiro técnico — cortes, enquadramento 9:16, textos, cor, áudio e exportação — e entrega um MP4 reproduzível.
owners: [isabela]
triggers: [editar vídeo, montar reels, cortar vídeo, exportar vídeo, legendar]
inputs: [roteiro técnico, arquivos de vídeo e foto, cores e fonte da marca]
tools: [arquivos, shell, ffmpeg, analise_imagem]
outputs: [entregas/video/<nome>.mp4, entregável categoria video]
---

## Etapas
1. Leia o roteiro técnico e confirme com `ffprobe` que cada arquivo e intervalo existe. Crie `trabalho/video/`.
2. Gere um segmento normalizado por plano (1080x1920, 30 fps, mesmo codec), para que a concatenação seja limpa.
   - Vídeo horizontal ou vertical → preencher 9:16 com corte central:
     `ffmpeg -v error -y -ss INICIO -t DUR -i "SRC" -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 20 -c:a aac -ar 48000 -ac 2 trabalho/video/seg01.mp4`
     Para deslocar o enquadramento, ajuste `crop=1080:1920:X:0`.
   - Clipe sem áudio → acrescente trilha silenciosa para manter os fluxos iguais: adicione `-f lavfi -t DUR -i anullsrc=r=48000:cl=stereo -shortest` e mapeie `-map 0:v -map 1:a`.
   - Foto → plano com zoom lento:
     `ffmpeg -v error -y -loop 1 -t DUR -i "FOTO" -f lavfi -t DUR -i anullsrc=r=48000:cl=stereo -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=z='min(zoom+0.0008,1.12)':d=1:s=1080x1920:fps=30,format=yuv420p" -c:v libx264 -crf 20 -c:a aac -shortest trabalho/video/seg02.mp4`
3. Tratamento de imagem (quando necessário), dentro do `-vf` do segmento: `eq=contrast=1.05:saturation=1.12:brightness=0.01`. Seja sutil e consistente entre planos.
4. Textos na tela com `drawtext` (confira a fonte com `fc-list | grep -i <nome>`; use caminho absoluto em `fontfile`). Coloque o texto em arquivo e use `textfile=` para evitar problemas de escape:
   `drawtext=fontfile=/caminho/Fonte-Bold.ttf:textfile=trabalho/video/t01.txt:fontsize=72:fontcolor=white:borderw=4:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.70`
   Mantenha os textos dentro da área segura (y entre 250 e 1500 px).
5. Concatene: liste os segmentos em `trabalho/video/lista.txt` (`file 'seg01.mp4'`) e rode
   `ffmpeg -v error -y -f concat -safe 0 -i trabalho/video/lista.txt -c copy trabalho/video/montagem.mp4`.
   Para transições com fusão use `xfade` entre pares; por padrão prefira corte seco, mais seguro e atual.
6. Áudio final: normalize o volume (`-af loudnorm=I=-14:TP=-1.5:LRA=11`). Trilha musical só se houver arquivo autorizado em `entrada/`: misture com `amix` reduzindo a trilha (`volume=0.25`) sob a fala e aplique `afade` na saída.
7. Exporte: `ffmpeg -v error -y -i trabalho/video/montagem.mp4 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 192k entregas/video/NOME.mp4`.
8. Valide (seção Validação) e registre com `registrar_entregavel` (categoria `video`). Reutilize o mesmo nome em ajustes para gerar nova versão.

## Validação
- `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of json entregas/video/NOME.mp4` → h264 + aac, 1080x1920, 30 fps, duração dentro de 0,5 s do pedido.
- Extraia um quadro por plano (`ffmpeg -v error -i NOME.mp4 -vf fps=1/3 trabalho/video/check_%02d.jpg`) e abra-os com Read: enquadramento correto, texto legível e sem corte.
- Arquivo abaixo de 100 MB para 30 s.

## Erros
- `drawtext` falha por fonte: liste fontes com `fc-list` e escolha uma existente; não entregue sem texto se o roteiro exigir.
- Falha na concatenação por parâmetros diferentes: recodifique o segmento divergente com os mesmos parâmetros.
- Qualquer comando com erro: leia a mensagem (rode sem `-v error` se preciso), corrija e repita; não entregue arquivo parcial.

## Limites
- Sem música não licenciada. Sem publicação: a prévia é registrada e aguarda aprovação. Não sobrescrever os arquivos originais.
