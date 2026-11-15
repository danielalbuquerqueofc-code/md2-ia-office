---
name: contract-review
title: Revisão de contrato
description: Analisa um contrato cláusula a cláusula, classifica riscos e propõe redações alternativas, como apoio à revisão por advogado.
owners: [helena]
triggers: [revisar contrato, analisar contrato, riscos do contrato, minuta, LGPD]
inputs: [contrato em entrada/ (PDF, DOCX ou texto), parte que o usuário representa]
tools: [arquivos]
outputs: [entregas/juridico/analise-contrato.md]
---

## Etapas
1. Leia o documento inteiro. Identifique partes, objeto, prazo, valor e a posição do usuário.
2. Percorra: objeto e escopo · preço, reajuste e pagamento · prazo e renovação · rescisão e multas · responsabilidade e limitação · propriedade intelectual · confidencialidade · proteção de dados (papéis de controlador e operador, finalidade, segurança, incidentes) · exclusividade e não concorrência · foro.
3. Para cada ponto: resumo, risco (alto, médio, baixo), por quê, e redação alternativa sugerida.
4. Liste cláusulas ausentes que seriam esperadas.
5. Feche com os cinco pontos mais importantes a negociar.

## Validação
- Toda observação cita a cláusula ou o trecho correspondente.
- Referências legais apenas quando seguras; caso contrário, "conferir na legislação vigente".
- O aviso de que a análise não substitui advogado consta no topo.

## Erros
- Documento ilegível ou incompleto: informe as páginas faltantes e analise o que houver.

## Limites
- Não é parecer jurídico. Não assinar, enviar ou alterar o documento original.
