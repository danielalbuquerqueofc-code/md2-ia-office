---
name: market-research
title: Pesquisa de empresa e mercado
description: Analisa a presença digital de uma empresa (site, Google, Instagram), seu público e concorrentes, e entrega um briefing com fontes para estratégia, textos e design.
owners: [mariana]
triggers: [analisar empresa, pesquisa de mercado, analisar google e instagram, concorrentes, briefing]
inputs: [nome da empresa e cidade, links (Google Maps, Instagram, site), materiais em entrada/]
tools: [web, arquivos, analise_imagem, playwright]
outputs: [entregas/pesquisa/briefing-empresa.md]
---

## Etapas
1. Reúna as entradas: links do pedido e arquivos em `entrada/`.
2. Leia cada link com a ferramenta de leitura web. Google Maps/Perfil da Empresa: nome, categoria, endereço, telefone, horário, nota e volume de avaliações, temas recorrentes das avaliações. Site atual: serviços, textos, estrutura, pontos fracos. Instagram: bio, link, tipos de conteúdo, tom — se a página exigir login e não puder ser lida, registre a limitação e peça capturas de tela ao usuário na devolutiva.
3. Complete com busca na web pelo nome + cidade (diretórios, notícias, redes) e confirme consistência de nome, endereço e telefone.
4. Identifique 3 a 5 concorrentes locais diretos pela busca "<serviço> em <cidade>" e descreva posicionamento, pontos fortes e lacunas de cada um. Liste 2 ou 3 referências de boa comunicação no segmento (de outras praças).
5. Sintetize: serviços e carro-chefe, diferenciais comprováveis, público (quem compra, quando, por quê), objeções comuns, tom de voz observado, palavras-chave de busca local.
6. Escreva `entregas/pesquisa/briefing-empresa.md` com seções: Dados confirmados (com URL de origem) · Serviços · Diferenciais · Público · Concorrentes · Oportunidades · Lacunas e informações a confirmar com o cliente.

## Validação
- Todo dado de contato e todo número têm URL de origem ao lado.
- Inferências estão rotuladas como "inferência".
- A seção de lacunas existe, mesmo que vazia.

## Erros
- Link inacessível ou bloqueado: tente a busca pelo nome; persistindo, registre como não verificado.
- Informações conflitantes entre fontes: apresente as duas e indique qual parece mais recente.

## Limites
- Só fontes públicas. Não criar contas, não fazer login, não contornar bloqueios. Não coletar dados pessoais de clientes da empresa.
