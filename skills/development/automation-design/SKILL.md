---
name: automation-design
title: Fluxos de automação reprodutíveis
description: Transforma uma tarefa repetitiva sobre arquivos em um script reexecutável, testado no workspace, com entradas, saídas e tratamento de erro documentados.
owners: [diego]
triggers: [automatizar, script, processar em lote, converter arquivos, fluxo repetitivo]
inputs: [descrição da tarefa, arquivos de exemplo em entrada/]
tools: [arquivos, shell]
outputs: [entregas/automacao/script.sh ou .py, entregas/automacao/LEIAME.md]
---

## Etapas
1. Descreva a entrada, a saída e a regra de transformação em uma frase cada.
2. Escreva o script em `entregas/automacao/` com parâmetros (sem caminhos fixos) e mensagens de erro claras.
3. Execute com os arquivos de exemplo e confira a saída de verdade.
4. Execute duas vezes e confirme que o resultado é idempotente (sem duplicar nem corromper).
5. Escreva o `LEIAME.md`: como rodar, dependências e limites conhecidos.

## Validação
- O script roda do zero em um diretório limpo.
- A segunda execução não altera o resultado.
- Erros de entrada (arquivo ausente, formato inválido) produzem mensagem e código de saída diferente de zero.

## Erros
- Dependência ausente: documente e use alternativa disponível; não instale nada fora do workspace.

## Limites
- Não conecte serviços externos nem use credenciais. Não altere os arquivos originais.
