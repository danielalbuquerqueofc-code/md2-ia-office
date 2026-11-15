---
title: Frontend, UX/UI e SEO técnico
summary: Padrões para construir sites rápidos, acessíveis, responsivos e com identidade própria.
tags: [frontend, html, css, ux, ui, responsivo, acessibilidade, performance, seo técnico, site]
updated: 2026-11
---

## Estrutura
HTML semântico (header, nav, main, section, footer), um h1 por página, headings em ordem. CSS com variáveis para cores, tipografia e espaçamento; layout com Grid e Flexbox; abordagem mobile-first com poucos breakpoints. JavaScript só onde agrega (menu, formulário, animações discretas).

## Design com identidade
Evite a cara de template: defina um sistema (paleta curta, duas famílias tipográficas no máximo, escala de espaçamento consistente) e uma ideia visual derivada da marca para o hero e os detalhes. Hierarquia vem de tamanho, peso e espaço em branco, não de mais cores. Contraste mínimo de 4,5:1 para texto.

## Responsividade
Teste em 360, 768 e 1280 px. Áreas de toque de pelo menos 44 px, texto base de 16 px, imagens fluidas, nada com rolagem horizontal. Menu móvel simples e acessível por teclado.

## Performance
Imagens no tamanho exibido e comprimidas, atributos de largura e altura para evitar salto de layout, carregamento tardio abaixo da dobra, fontes com fallback de sistema e `font-display: swap`, mínimo de scripts de terceiros.

## Acessibilidade
Texto alternativo, rótulos em campos, foco visível, ordem de tabulação lógica, respeito a `prefers-reduced-motion`, não depender só de cor para transmitir informação.

## Formulários e contato
Poucos campos, validação nativa, mensagem clara de sucesso e erro. Em sites estáticos, o formulário pode montar uma mensagem de WhatsApp; envio por e-mail exige um serviço de backend ou de formulários.
