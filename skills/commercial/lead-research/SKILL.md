---
name: lead-research
title: Pesquisa e qualificação de leads
description: Monta uma lista qualificada de empresas-alvo a partir de fontes públicas, com motivo de encaixe e abordagem inicial personalizada.
owners: [lucas]
triggers: [prospecção, lista de leads, encontrar empresas, qualificar leads, abordagem]
inputs: [segmento, região, perfil de cliente ideal, oferta, quantidade desejada]
tools: [web, arquivos]
outputs: [entregas/comercial/leads.csv, entregas/comercial/abordagens.md]
---

## Etapas
1. Defina os critérios de encaixe (segmento, porte, região, sinais de necessidade — ex.: sem site, poucas avaliações, Instagram desatualizado).
2. Pesquise na web por "<segmento> em <cidade>" e variações; para cada empresa colete nome, site/perfil, telefone comercial público, cidade e o sinal observado, com a URL de origem.
3. Pontue de 1 a 5 pelo encaixe e justifique em uma linha.
4. Salve `entregas/comercial/leads.csv` (colunas: empresa, cidade, contato_publico, site_ou_perfil, sinal, nota, justificativa, fonte).
5. Escreva em `abordagens.md` a mensagem inicial para os melhores leads: observação específica sobre a empresa, hipótese de ganho, pergunta aberta. Uma versão para WhatsApp e uma para e-mail.

## Validação
- Toda linha tem fonte. Nenhum contato pessoal (celular de sócio, e-mail pessoal) obtido fora de canal comercial público.
- Mensagens citam algo verificável da empresa.

## Erros
- Poucos resultados: amplie região ou segmento adjacente e avise.

## Limites
- Não enviar mensagens. Não raspar dados em massa nem usar bases compradas. Respeitar a LGPD: apenas dados comerciais públicos, com finalidade de contato B2B.
