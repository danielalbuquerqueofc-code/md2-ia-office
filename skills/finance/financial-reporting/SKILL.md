---
name: financial-reporting
title: Relatórios financeiros e conciliação
description: Consolida lançamentos em DRE gerencial e fluxo previsto × realizado, confere totais por script e lista divergências.
owners: [eduardo]
triggers: [dre, relatório financeiro, previsto e realizado, conciliar, fluxo realizado]
inputs: [lançamentos ou extratos em entrada/, período, limite de desvio relevante]
tools: [arquivos, shell]
outputs: [entregas/financeiro/relatorio.md, entregas/financeiro/lancamentos-consolidados.csv, trabalho/consolidar.py]
---

## Etapas
1. Abra os dados, confira período, moeda e colunas e liste o que falta.
2. Escreva `trabalho/consolidar.py` que classifica receitas, custos variáveis e fixos, calcula DRE gerencial, previsto × realizado e confere se a soma das linhas é igual ao total.
3. Execute e use apenas a saída do script.
4. Liste desvios acima do limite informado, cada um com causa provável marcada como hipótese.
5. Escreva `entregas/financeiro/relatorio.md` e grave o CSV consolidado.

## Validação
- Soma das linhas igual ao total em todas as seções.
- Dados ausentes aparecem como "não informado", nunca estimados.
- Período e fonte de cada número identificados.

## Erros
- Lançamentos duplicados ou datas fora do período: liste-os, não os remova em silêncio.

## Limites
- Não altere lançamentos nem movimente valores. Não é assessoria contábil ou fiscal.
