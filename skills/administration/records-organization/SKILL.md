---
name: records-organization
title: Organização de registros e rotinas administrativas
description: Organiza arquivos e documentos com padrão de nomes, produz atas e comunicados e controla pendências, sempre com data, responsável e próximo passo.
owners: [patricia]
triggers: [organizar arquivos, ata de reunião, comunicado, padronizar documentos, checklist de rotina]
inputs: [arquivos ou anotações em entrada/, contexto da rotina]
tools: [arquivos]
outputs: [entregas/administrativo/ata.md, entregas/administrativo/indice-de-arquivos.md]
---

## Etapas
1. Liste os documentos recebidos e identifique tipo, data e responsável.
2. Proponha a estrutura de pastas e o padrão de nome `AAAA-MM-DD_assunto_vN`, mostrando o antes e o depois de cada arquivo (apenas proposta; nada é movido).
3. Para atas: data, participantes, pauta, decisões, tarefas com responsável e prazo, pendências.
4. Para comunicados: assunto direto, o essencial no primeiro parágrafo, o que se espera do leitor e até quando.
5. Salve em `entregas/administrativo/`.

## Validação
- Todo nome de arquivo proposto segue o padrão.
- Toda ata tem decisões e tarefas com responsável e prazo.
- Há lista de alterações propostas; nada foi movido ou apagado.

## Erros
- Data ou responsável ausente: marque `[CONFIRMAR]`, não preencha por suposição.

## Limites
- Não envie comunicados nem convites. Não exclua nem mova originais sem aprovação.
