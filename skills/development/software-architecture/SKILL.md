---
name: software-architecture
title: Arquitetura técnica de solução
description: Desenha a solução antes de implementar: estrutura de informação, componentes, contratos de dados, SEO técnico e desempenho, com decisões justificadas.
owners: [camila]
triggers: [arquitetura, desenho técnico, contrato de dados, seo técnico, integração]
inputs: [briefing, textos e direção visual quando existirem, restrições técnicas]
tools: [arquivos, web, analise_imagem]
outputs: [entregas/design/especificacao-tecnica.md]
---

## Etapas
1. Leia o briefing e identifique o objetivo, o público e as restrições (hospedagem, orçamento, prazo).
2. Escolha a solução mais simples que atende (site estático antes de backend) e registre a alternativa descartada e o motivo.
3. Defina a estrutura: páginas ou seções, componentes, dados e integrações, e o contrato de cada integração (entradas, saídas, erros).
4. Defina requisitos técnicos: SEO (title, description, headings, dados estruturados), desempenho (peso de imagens, carregamento tardio), responsividade (360, 768, 1280 px) e acessibilidade.
5. Liste riscos e o que depende de terceiros (credenciais, domínio, hospedagem).
6. Salve em `entregas/design/especificacao-tecnica.md` (~10 KB ou menos).

## Validação
- Cada componente tem função e origem do conteúdo.
- Há alternativa descartada com motivo.
- Toda dependência externa está marcada como pendente ou fornecida.

## Erros
- Requisito ambíguo: liste a ambiguidade e a hipótese adotada para o desenvolvedor.

## Limites
- Não escreva código de produção nem publique. Não copie arquitetura ou identidade de terceiros.
