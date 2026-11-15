---
name: security-audit
title: Auditoria de segurança
description: Revisa código e configuração em busca de segredos expostos, entradas não validadas e práticas inseguras, com recomendações priorizadas.
owners: [sofia, andre]
triggers: [auditoria de segurança, revisar segurança, vazamento de chave, LGPD técnica]
inputs: [código ou site no workspace]
tools: [arquivos, shell]
outputs: [entregas/seguranca/relatorio-seguranca.md]
---

## Etapas
1. Mapeie o que será auditado (linguagens, pontos de entrada, dados tratados).
2. Segredos: `grep -rInE "(api[_-]?key|secret|token|password|senha)\s*[:=]" --exclude-dir=node_modules .` e revise cada ocorrência.
3. Entradas: localize formulários, parâmetros e uploads; verifique validação, escape de saída (XSS) e uso de consultas parametrizadas.
4. Dependências: se houver `package.json`, rode `npm audit --omit=dev` e resuma.
5. Configuração: cabeçalhos de segurança, HTTPS, cookies (`HttpOnly`, `Secure`, `SameSite`), CORS.
6. Dados pessoais: liste quais são coletados e se há base legal e aviso de privacidade.
7. Relate achados com gravidade (crítica, alta, média, baixa), evidência (arquivo:linha) e correção.

## Validação
- Todo achado tem evidência localizável. Nenhum segredo real é reproduzido no relatório (mascarar).

## Erros
- Ferramenta de auditoria indisponível: faça a revisão manual e declare o que não foi coberto.

## Limites
- Apenas análise defensiva do próprio workspace. Não testar invasão em sistemas de terceiros.
