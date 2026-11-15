---
name: financial-analysis
title: Análise financeira e precificação
description: Calcula fluxo de caixa, DRE gerencial, margem, ponto de equilíbrio e preço de serviços com memória de cálculo reproduzível.
owners: [roberto, aline]
triggers: [fluxo de caixa, DRE, precificação, quanto cobrar, margem, ponto de equilíbrio, custos]
inputs: [receitas, custos fixos e variáveis, impostos, horas ou capacidade]
tools: [arquivos, shell]
outputs: [entregas/financeiro/analise.md, entregas/financeiro/calculo.csv]
---

## Etapas
1. Organize os dados de entrada em tabela e aponte o que falta.
2. Calcule com script (Python ou Node) salvo em `trabalho/financeiro/`, nunca de cabeça.
3. Precificação de serviço: custo direto + rateio de custos fixos + impostos + margem desejada; mostre preço mínimo, preço-alvo e margem resultante.
4. Ponto de equilíbrio = custos fixos ÷ margem de contribuição unitária.
5. Fluxo de caixa: entradas e saídas por período, saldo acumulado e meses críticos.
6. Apresente cenários conservador, base e otimista quando houver incerteza.
7. Escreva a análise com conclusões e recomendações; anexe o CSV.

## Validação
- Reexecute o script e confira que os números do relatório são os da saída.
- Premissas e alíquotas declaradas com a origem (informada pelo usuário ou a confirmar com o contador).

## Erros
- Regime tributário desconhecido: calcule sem imposto, destaque o aviso e peça a informação.

## Limites
- Não é assessoria contábil ou fiscal. Não movimentar valores.
