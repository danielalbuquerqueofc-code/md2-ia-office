---
name: performance-analysis
title: Análise de desempenho de marketing
description: Calcula métricas de campanhas, site e funil a partir dos dados fornecidos, com script reproduzível, e recomenda decisões conforme o volume de dados permite.
owners: [gabriel]
triggers: [relatório de resultados, desempenho da campanha, métricas, cpl, cac, análise de dados de marketing]
inputs: [dados em entrada/ (CSV, exportações, capturas), objetivo da campanha, período]
tools: [arquivos, shell]
outputs: [entregas/relatorios/desempenho.md, entregas/relatorios/calculo.csv, trabalho/analise.py]
---

## Etapas
1. Abra os dados, confira colunas, período e unidades e liste o que falta.
2. Escreva `trabalho/analise.py` que calcula as métricas por etapa (alcance, cliques, CTR, custo por clique, leads ou conversas, custo por lead, taxa de fechamento, CAC quando houver vendas) e grava `entregas/relatorios/calculo.csv`.
3. Execute o script e use somente a saída dele no relatório.
4. Compare períodos equivalentes e identifique a etapa onde a taxa cai mais.
5. Declare o volume de dados e diga quando é insuficiente para concluir.
6. Escreva `entregas/relatorios/desempenho.md`: o que investimos, o que voltou, o que aprendemos, o que fazer, com gatilho mensurável para cada recomendação.

## Validação
- Reexecutar o script reproduz os números do relatório.
- Nenhum dado ausente foi estimado.
- Cada recomendação tem um gatilho (métrica, limite, janela).

## Erros
- Colunas inconsistentes ou datas conflitantes: aponte a inconsistência, não corrija em silêncio.
- Volume pequeno: relate tendência provisória e o que coletar.

## Limites
- Sem acesso a contas de anúncio. Não altere campanhas.
