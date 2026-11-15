---
name: content-review
title: Revisão de conteúdo
description: Revisa clareza, correção e consistência de textos contra o briefing e o guia de marca e devolve a versão corrigida com tabela de alterações.
owners: [vinicius]
triggers: [revisar texto, revisão final, consistência de marca, conferir legenda, proofreading]
inputs: [texto a revisar, briefing, guia de marca quando existir]
tools: [arquivos, analise_imagem]
outputs: [entregas/textos/revisao.md]
---

## Etapas
1. Leia o briefing e o guia de marca antes do texto.
2. Revise ortografia, gramática (pt-BR), pontuação e clareza, preservando a voz do autor.
3. Verifique consistência: nomes, preços, horários, contatos, termos e tom iguais em todo o conteúdo.
4. Marque toda afirmação factual (número, prazo, prêmio, garantia) e confira se consta no briefing; as que não constarem vão para a lista "sem fonte".
5. Entregue em `entregas/textos/revisao.md`: versão revisada, tabela de alterações (antes, depois, motivo) e lista "sem fonte".

## Validação
- Cada alteração tem motivo registrado.
- Nenhuma afirmação factual nova foi introduzida na revisão.
- A lista "sem fonte" existe, mesmo que vazia.

## Erros
- Texto fora do tom do guia: aponte o trecho e peça reescrita à redatora em vez de reescrever.

## Limites
- Não altere fatos. Não publique. Não substitua o estilo do autor por preferência pessoal.
