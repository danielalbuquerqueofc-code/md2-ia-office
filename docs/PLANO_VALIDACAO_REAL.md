# Plano de validação real

Objetivo: provar, com material **real**, que o MD2 IA Office entrega serviço profissional de ponta a ponta nos dois fluxos prioritários, sem inflar o resultado. Este plano vale para você executar quando tiver o material; nada aqui foi executado com dados reais de cliente.

## Regras que impedem declarar sucesso falso

1. **Preflight primeiro, sem custo.** `npm run preflight` mede fatos do material e do ambiente antes de qualquer chamada ao modelo.
2. **Material sintético ou de teste nunca valida o cenário B.** O preflight acusa por fatos (sem metadados de câmera, gerado por FFmpeg, imagem lisa demais, texto de "teste" na pasta) e o executor **aborta antes de gastar**. Rodar assim mesmo exige `--teste-tecnico`, e o resultado sai sempre **NÃO VALIDADO**.
3. **Você atesta que o material é real** com `--material-real`. Sem isso, o cenário B não é validado.
4. **A verificação é independente**: o executor mede o vídeo com ffprobe e o site com um navegador, sem confiar no relato dos agentes.
5. **Três níveis de resultado**: `VALIDADO`, `VALIDADO_COM_RESSALVAS` (a causa fica escrita) e `NAO_VALIDADO` (os motivos ficam escritos).
6. **Nada é publicado, enviado ou gasto fora do teto.** Os tetos (US$ 5 por tarefa, US$ 15 por execução, US$ 60 por dia) não são alterados pela validação.

## Onde rodar (importante)

| Ambiente | Isolamento dos agentes | Serve para validar? |
|---|---|---|
| **Linux ou WSL2 (Ubuntu)** com `bubblewrap` e `socat` | Ativo | **Sim.** É o ambiente recomendado |
| **Windows nativo** | **Indisponível** (o sandbox de SO só foi validado em Linux) | **Não**: a classificação exige o isolamento ativo |
| macOS | Não verificado | Não validado |
| Este ambiente em nuvem | Ativo | Não enxerga o seu notebook; só serve se você **anexar** os arquivos pela interface |

As evidências do repositório original (PowerShell, `icacls`, ajustes de teste no Windows) indicam que o seu notebook é Windows. Dois caminhos:

- **Caminho 1, o mais simples: anexar os vídeos na Central de Comando** (até 500 MB por arquivo). Funciona em qualquer ambiente com o servidor rodando em Linux. Não exercita o "encontrar a pasta no notebook".
- **Caminho 2: WSL2.** Instale o Ubuntu no WSL2, instale as dependências e autorize a pasta pelo caminho do Windows. **Não foi testado**, só descrito:

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg bubblewrap socat
```

```bash
# a pasta do Windows aparece em /mnt/c/...
npm run preflight -- --cenario b --pasta "/mnt/c/Users/SEU_USUARIO/Clientes/Pão de Mel"
```

Em WSL2 a leitura em `/mnt/c` é mais lenta que em disco Linux; pastas grandes demoram mais.

## Cenário B — Reels de 30 s a partir de pasta com vídeos reais

### Arquivos e informações necessários

| Item | Obrigatório | Especificação |
|---|---|---|
| Pasta com vídeos | **Sim** | De 3 a 15 clipes **reais**, filmados em celular ou câmera, **sem edição prévia**, total de **pelo menos 60 s** (o ideal é 3 min ou mais, para haver o que escolher). Formatos `.mp4` ou `.mov`, de preferência 1080p ou mais, vertical ou horizontal, com áudio ambiente |
| Fotos | Não | JPG ou PNG (HEIC não é lido). Pelo menos 3, se houver |
| Tema do vídeo | **Sim** | Uma frase, por exemplo "o café da tarde" |
| Nome do negócio e público | Recomendado | Só o que for verdadeiro; o que faltar vira pendência, não invenção |
| Logo e cor da marca | Não | PNG ou SVG; hexadecimal da cor |
| Música | Não | Só com licença comprovada para uso comercial (arquivo + comprovante). Sem isso o vídeo sai sem trilha, e isso consta como pendência |
| Texto de chamada para ação | Não | Por exemplo o WhatsApp ou o endereço, **se você confirmar** |
| Autorização de uso das imagens | **Sim** | Você confirma que tem direito de uso e que não há pessoas que não autorizaram aparecer |

### Passo a passo

1. Coloque os arquivos em uma pasta e indique-a em `MD2_AUTHORIZED_DIRS` no `.env` (**a pasta, não o disco**).
2. Rode o preflight (não gasta nada):

```bash
npm run preflight -- --cenario b --pasta "/caminho/Pão de Mel" --duracao 30
```

3. Veja o plano que Alfred faria (US$ 0,10 a 0,40, opcional):

```bash
npm run plan:preview -- "Alfred, encontre a pasta Pão de Mel no meu notebook, analise os vídeos e fotografias, produza um Reels de 30 segundos sobre o café da tarde, gere a legenda e apresente a prévia."
```

4. Execute (consome créditos, dentro dos tetos):

```bash
npm run build
```

```bash
node e2e/real-operation.mjs --cenario=b --pasta="/caminho/Pão de Mel" --tema="o café da tarde" --material-real
```

O executor sobe o servidor de teste lendo **somente** essa pasta, envia o pedido, acompanha até o fim, mede o vídeo e grava o relatório em `data-noturno-relatorio.json` (ou no diretório indicado em `--dados`).

### Fluxo esperado (conforme a prévia do Alfred, 15/11/2026)

Diego (inventário técnico: ffprobe, folhas de contato, descrição visual e indícios sobre a natureza do material) → Isabela (roteiro plano a plano, legenda, capa e avaliação honesta do material) → Vinícius (revisão dos textos na tela e da legenda) → Diego (edição e exportação com FFmpeg, script `montar.sh` reexecutável) → Sofia (QA com ffprobe e quadros) → Amanda (aceite contra o pedido). Nada é publicado: a prévia aguarda a sua aprovação.

### Verificação independente

MP4 H.264 + AAC, 1080x1920, 30 fps, duração 30 s ±0,5, menos de 100 MB, decodifica sem erro, não é majoritariamente preto, legenda entregue, mais: execução concluída, sandbox ativo, Diego, Isabela e Sofia com tarefa concluída.

### Avaliação sua (o que nenhum teste automático mede)

Responda sim ou não: (1) os trechos escolhidos são os melhores do material? (2) a ordem conta uma história com gancho, desenvolvimento e fechamento? (3) o texto na tela é legível e está na área segura? (4) a legenda é específica do negócio, sem informação inventada? (5) você postaria este vídeo, no máximo com pequenos ajustes? Cenário B só entra como "validado com sua aprovação" com **5 sim**.

## Cenário A — Site profissional a partir de Google Maps e Instagram

### Arquivos e informações necessários

| Item | Obrigatório | Especificação |
|---|---|---|
| Link do Google Maps | **Sim** | URL pública do perfil da empresa |
| Link do Instagram | **Sim** | URL pública do perfil. **O Instagram quase sempre exige login:** envie também capturas de tela (bio, pelo menos 9 posts, destaques) |
| Capturas das avaliações do Google | Recomendado | O Maps carrega parte do conteúdo por JavaScript; prints das avaliações garantem o dado |
| Logo | Recomendado | PNG ou SVG |
| Fotos reais da empresa | Recomendado | De 5 a 15 imagens JPG ou PNG. Sem fotos, o site usa espaços marcados, nunca imagens genéricas fingindo ser da empresa |
| Serviços, diferenciais e (se tiver) preços | **Sim** | Só informações verdadeiras. O que faltar fica como pendência |
| WhatsApp, endereço e horário reais | **Sim** | Se faltar algum, o site sai com marcador "A CONFIRMAR" |
| Site atual | Se existir | URL |
| Autorização do cliente | **Sim** | Você confirma que o cliente autorizou a análise e a criação |

Não são necessários domínio nem hospedagem: **nada é publicado**.

### Passo a passo

```bash
npm run preflight -- --cenario a --maps "URL" --instagram "URL" --logo "/caminho/logo.png" --fotos "/caminho/fotos"
```

```bash
node e2e/real-operation.mjs --cenario=a --maps="URL" --instagram="URL" --anexos="/caminho/logo.png,/caminho/instagram-bio.png" --briefing="serviços, diferenciais e contatos reais"
```

O preflight testa se o Instagram e o Maps abrem sem login a partir da sua máquina e **avisa antes de gastar**.

### Fluxo esperado (conforme a prévia do Alfred, 15/11/2026)

Lucas (presença digital e oportunidades comerciais) ∥ Mariana (concorrentes e posicionamento) → Beatriz (identidade e tom) → Isabela (textos) ∥ Camila (arquitetura e layout) → Vinícius (revisão) → André (construção) → Sofia (QA) → Amanda (aceite).

### Verificação independente

Em 360, 768 e 1280 px: sem rolagem horizontal, sem erro de console, nenhum recurso quebrado. No desktop: um único `h1`, `title` até 60 caracteres, meta description até 160, todas as imagens com `alt`, link de WhatsApp presente, sem "lorem ipsum", âncoras internas existentes. As capturas de tela ficam em `<dados>-evidencias/`. Mais: Alfred acionou André e Sofia, Sofia concluiu, e há entregável do tipo site.

### Avaliação sua (qualidade de R$ 2.000 ou mais)

Responda sim ou não: (1) a primeira dobra comunica o que a empresa faz e leva a uma ação? (2) a identidade é própria e não parece modelo pronto? (3) os textos são específicos desta empresa e sem informação inventada? (4) a estrutura difere dos concorrentes pesquisados? (5) o formulário e o WhatsApp funcionam? (6) a leitura no celular é confortável? (7) as pendências de conteúdo estão listadas e são aceitáveis? (8) as informações são iguais em todo o site (nome, telefone, horário)? (9) você apresentaria este site a um cliente pagante? Qualidade comercial confirmada com **9 sim**; menos que isso volta como lista de ajustes.

## Custo esperado e risco de teto

| Cenário | Referência medida | Observação |
|---|---|---|
| B | US$ 2,36 a 2,87 (3 tarefas, material sintético) | O plano atual tem 6 tarefas; a estimativa é de US$ 4 a 7 |
| A | US$ 9,22 (6 agentes) | O plano atual tem 9 tarefas; a estimativa é de US$ 10 a 14, **perto do teto de US$ 15 por execução**. Se o teto for atingido, o sistema cancela as tarefas pendentes e informa. **Não aumentei o teto**; a decisão é sua |

Esses valores são estimativas a partir de execuções anteriores, não garantias.

## O que ainda não foi executado

- Nenhum dos dois fluxos foi executado com **material real**.
- O pipeline do cenário B com a nova divisão de papéis (inventário, roteiro, revisão, edição, QA, aceite) foi executado uma vez com material **sintético, como teste técnico, e não valida o cenário** (ver `docs/FASE_2_RELATORIO.md`).
- O pipeline do cenário A com os 9 agentes foi apenas planejado (prévia), não executado.
- Playwright MCP ainda não foi usado por um agente; sem ele, o QA visual do site usa o Chrome headless pelo shell.
- O sandbox no WSL2 e a leitura de pastas do Windows não foram testados.

## O que enviar de volta

O arquivo `<dados>-relatorio.json` (classificação, verificações, custos por agente) e as suas respostas sim/não. Com isso classifico o cenário e registro o resultado em `docs/STATUS.md`.
