---
name: website-builder
title: Construção de site profissional
description: Constrói um site institucional completo, responsivo e com identidade própria a partir de briefing, textos e direção visual, e entrega uma prévia funcional.
owners: [bruno, thiago]
triggers: [criar site, site profissional, landing page, página institucional, refazer site]
inputs: [briefing da empresa (pesquisa), textos por seção, direção visual (tokens), logo e fotos em entrada/ quando houver]
tools: [arquivos, shell, analise_imagem, playwright]
outputs: [entregas/site/index.html e recursos, entregável categoria site]
---

## Quando usar
Pedido de site, landing page ou página institucional para uma empresa real, com padrão comercial (referência de valor: R$ 2.000 ou mais).

## Entradas obrigatórias
1. Briefing com serviços, diferenciais, público, contatos (telefone/WhatsApp, endereço, horário) e fontes.
2. Textos por seção.
3. Direção visual: paleta, tipografia, estilo, referências de estrutura.
Se alguma faltar, use o que existir nas dependências; nunca preencha com dados inventados. Campo sem dado vira lacuna declarada na devolutiva (ex.: "telefone não localizado: botão de WhatsApp aponta para placeholder marcado com TODO").

## Etapas
1. Leia os resultados das dependências e os arquivos de `entrada/` (abra imagens com Read para conhecer logo e fotos).
2. Defina a arquitetura da página a partir do objetivo de conversão. Estrutura base recomendada: cabeçalho fixo com CTA · hero com proposta de valor · prova (números reais, avaliações do Google citadas com fonte) · serviços · diferenciais · sobre · galeria (se houver fotos) · perguntas frequentes · contato com mapa/endereço, formulário e WhatsApp · rodapé. Remova seções para as quais não há conteúdo real.
3. Crie `entregas/site/` com `index.html`, `css/style.css`, `js/main.js`, `assets/`. Site estático e autocontido: sem CDN obrigatória, sem etapa de build, caminhos relativos. Fontes: use `@font-face` local se o arquivo existir, senão pilha de fontes do sistema coerente com a direção visual.
4. Implemente a direção visual com variáveis CSS (`:root`) — cores, tipografia, espaçamentos, raio, sombras. Layout em CSS Grid/Flexbox, mobile-first, breakpoints em 768 e 1100 px. Nada de aparência de template: a composição do hero, o ritmo das seções e os detalhes gráficos devem derivar da marca.
5. Imagens: use as do cliente (copie de `entrada/` para `assets/`, redimensione com ffmpeg se muito grandes: `ffmpeg -i in.jpg -vf "scale='min(1600,iw)':-2" -q:v 3 out.jpg`). Sem fotos, use composições em CSS/SVG próprias; nunca hotlink nem banco de imagens sem licença.
6. SEO on-page: `<title>` (até 60 caracteres, com serviço + cidade), meta description (até 155), um único `h1`, hierarquia de headings, `alt` em imagens, `lang="pt-BR"`, Open Graph, favicon, JSON-LD `LocalBusiness` apenas com dados confirmados, `robots.txt` e `sitemap.xml`.
7. Conversão: botão flutuante de WhatsApp com link `https://wa.me/55DDDNUMERO?text=...` e mensagem pré-preenchida; telefone com `tel:`; formulário com validação nativa e JS que monta a mensagem e abre o WhatsApp (funciona sem backend). Se o cliente precisar receber por e-mail, documente em `LEIAME.md` que isso exige um endpoint de formulário e deixe o `action` configurável.
8. Acessibilidade: contraste AA, foco visível, navegação por teclado, `aria-label` em ícones, `prefers-reduced-motion`.
9. Escreva `entregas/site/LEIAME.md`: como publicar, o que configurar (domínio, endpoint do formulário, Analytics/Pixel) e lista de lacunas de conteúdo.
10. Verifique (seção Validação) e só então registre com `registrar_entregavel` (caminho `entregas/site`, categoria `site`, nome "Site — <empresa>").

## Validação
- `index.html` abre sem dependências externas quebradas: `grep -oE '(src|href)="[^"#]+"' index.html` e confirme que cada caminho relativo existe.
- HTML bem formado: um `h1`, `title` e `meta description` presentes, todas as imagens com `alt`.
- Links de WhatsApp e telefone com número real ou marcados como lacuna.
- Responsividade: se a ferramenta de navegador estiver disponível, capture 360, 768 e 1280 px e inspecione as capturas; caso contrário, revise as regras de media query e declare que a verificação visual não foi feita.
- Nenhum texto "lorem ipsum" nem dado inventado: `grep -ri "lorem" entregas/site` deve voltar vazio.

## Erros
- Link do cliente inacessível: siga com o material disponível e liste o que não pôde ser confirmado.
- Imagem corrompida ou formato não suportado: converta com ffmpeg; se falhar, não use e avise.
- Falta de conteúdo para uma seção: remova a seção em vez de preencher com texto genérico.

## Limites
- Não publicar, registrar domínio nem fazer deploy: a entrega é a prévia local. Publicação exige `solicitar_aprovacao` (tipo publicacao).
- Não copiar layout, textos ou identidade de concorrentes.
- Não inserir scripts de rastreamento sem identificadores fornecidos pelo cliente.
