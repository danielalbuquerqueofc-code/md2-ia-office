---
name: media-inventory
title: Inventário técnico de material de mídia
description: Localiza a pasta de material (enviada ou autorizada), inventaria cada arquivo com ffprobe, gera quadros e folhas de contato e registra fatos técnicos e indícios sobre a natureza do material, sem inventar conteúdo.
owners: [diego]
triggers: [inventariar vídeos, analisar pasta de vídeos, material bruto, achar pasta, selecionar trechos]
inputs: [nome da pasta ou arquivos em entrada/, pastas locais autorizadas (listadas no pedido), tema e duração do vídeo pretendido]
tools: [arquivos, shell, ffmpeg, analise_imagem]
outputs: [entregas/video/inventario.md, trabalho/analise/*.jpg (folhas de contato)]
---

## Etapas
1. Localize o material. Procure primeiro em `entrada/`. Depois use a lista de pastas autorizadas do pedido (nunca saia delas). A busca precisa ignorar acentos e maiúsculas, porque o nome real da pasta pode vir normalizado de outra forma (ex.: "Pão de Mel"):
   ```
   python3 - "pao de mel" /pasta/autorizada <<'PY'
   import sys, os, unicodedata
   norm = lambda s: unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
   alvo = norm(sys.argv[1])
   for raiz in sys.argv[2:]:
       for d, subs, _ in os.walk(raiz):
           if d[len(raiz):].count(os.sep) > 4: subs[:] = []
           for s in subs:
               if alvo in norm(s): print(os.path.join(d, s))
   PY
   ```
   Se a pasta pedida não existir nesses locais, **pare** e informe exatamente onde procurou. Não use outro material no lugar.
2. Liste os arquivos de vídeo, foto e áudio (por extensão) e leia arquivos de texto da pasta (README, LEIAME) — eles podem dizer que o material é de teste.
3. Para cada arquivo, rode `ffprobe -v error -print_format json -show_format -show_streams "arquivo"` e registre: duração, resolução, orientação (considere rotação), fps, codec, presença de áudio e as tags de origem (`creation_time`, `make`, `model`, `encoder`, `com.apple.quicktime.*`).
4. Gere folhas de contato para ver o conteúdo de verdade: `ffmpeg -v error -i "arquivo" -vf "fps=N,scale=320:-2,tile=6x4" -frames:v 1 trabalho/analise/NOME.jpg`, com N calculado para caber ~24 quadros (24 ÷ duração). Abra cada folha com Read.
5. Detecte problemas técnicos por arquivo: `blackdetect`, `freezedetect`, `silencedetect`/`volumedetect` e cortes de cena (`select='gt(scene,0.3)',showinfo`). Registre intervalos inutilizáveis.
6. Escreva `entregas/video/inventario.md`: tabela (caminho absoluto, duração, resolução, orientação, fps, áudio, tags de origem, problemas) e uma seção **Natureza do material** com os fatos observados (tags de câmera presentes ou ausentes, nomes de arquivo, texto sobreposto às imagens, áudio contínuo artificial, LEIAME) e a conclusão **"indícios de material real"** ou **"indícios de material sintético ou de teste"**, sem afirmar mais do que os fatos sustentam.
7. Registre o inventário com `registrar_entregavel` (categoria documento) e deixe as folhas de contato em `trabalho/analise/` para o roteirista.

## Validação
- Todo arquivo da pasta aparece no inventário; ilegíveis constam com o erro do ffprobe.
- Toda folha de contato citada existe e foi aberta.
- A seção "Natureza do material" cita fatos, não impressões.
- Nenhum arquivo original foi alterado ou movido.

## Erros
- Pasta não encontrada: relate os caminhos pesquisados e pare.
- ffprobe falha em um arquivo: liste-o como ilegível e siga com os demais.
- Pasta muito grande (mais de 40 arquivos): inventarie tudo em tabela, mas gere folhas de contato apenas dos 15 maiores e diga isso.

## Limites
- Leia as pastas autorizadas, nunca escreva nelas. Derivados (quadros, folhas) ficam só no workspace.
- Não baixe material da internet.
- Não conclua que o material é real ou falso: relate indícios. A confirmação é do usuário.
