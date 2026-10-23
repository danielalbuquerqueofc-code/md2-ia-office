# MD2 IA Office — primeira implementação

Base preservada: Pixel Agents, PR #228, commit 6a85d0e8f248ba573a9f953fef3e1319e405c746.
Branch local: md2/primeira-versao.

Esta versão é uma extensão VS Code, não um serviço web publicado.
O escritório usa o canvas, sprites, móveis e editor originais. A PR traz o adaptador Codex e o mapeamento de eventos. Não foi integrada à main atual: a PR está aberta e com conflitos, e a main já é 1.5.0.

## Uso

Node.js 20+ e VS Code 1.105+. Instalar dependências na raiz, em server e webview-ui com npm ci; executar npm run build na raiz. Abrir o projeto no VS Code e iniciar Extension Development Host (F5). Abrir Pixel Agents, selecionar Codex e + Agent. Digitar tarefas no terminal do agente.
O executável codex precisa estar no PATH. Alternativamente, definir MD2_CODEX_COMMAND com caminho absoluto do executável antes de iniciar VS Code. Não colocar credenciais no repositório.

O painel MD2 mostra tarefas e os oito eventos mais recentes desta sessão, sem inventar agentes ativos. O centro de aprovações inicial usa confirmação modal nativa do VS Code. Fechar, falhar a conexão ou expirar em 120 segundos nega o pedido. Permissões adicionais são negadas. A configuração de ignorar permissões não é repassada ao Codex. A política untrusted e sandbox workspace-write são explícitos no início da sessão.

## Limitações que impedem considerar a versão final

Histórico de tarefas somente em memória; ainda não há banco, fila durável, trilha de auditoria persistente ou centro de aprovações completo dentro do escritório. Pedidos desconhecidos não recebem autorização. Ainda é necessário revisar ferramentas e MCP herdados da configuração local e testar os limites com ações reais. A confirmação protege pedidos enviados pelo Codex; não classifica por conta própria toda ação sensível. Não usar como barreira de segurança de produção.
A integração visual completa, o fluxo de confirmação humana e uma tarefa real de programação ainda precisam de teste completo no Extension Development Host. O teste real realizado foi uma resposta sem ferramentas; não comprova programação ou publicação.
O suporte Claude permanece herdado da PR e fora da validação MD2.

## Sete departamentos e vinte agentes (planejados, não executando)

| Departamento | Agentes | Quantidade |
|---|---|---:|
| Diretoria e Estratégia | Diretor de IA, Planejamento | 2 |
| Comercial e Vendas | Prospecção, Qualificação, Propostas, Fechamento | 4 |
| Marketing | Estratégia, Conteúdo, Mídia | 3 |
| Operações | Projetos, Design, Entregas | 3 |
| Atendimento | Suporte, Retenção | 2 |
| Financeiro | Cobrança, Controle | 2 |
| Tecnologia | Programador Codex, Arquitetura, Automação, Qualidade | 4 |

Próxima etapa: persistir tarefas e decisões, projetar sete áreas no editor e associar cada personagem somente a uma sessão real. Introduzir os demais agentes progressivamente, com responsabilidades, orçamento e permissões delimitados.

## WhatsApp

Planejar inicialmente conversas individuais, opt-in, webhooks autenticados e modelos aprovados quando exigidos pela Meta. Não prometer integração com grupos comuns nem vinte agentes em um grupo. Antes de implementar grupos, confirmar documentação oficial atual, elegibilidade da conta, participantes e limitações. A consulta à página oficial de grupos nesta sessão retornou HTTP 429; os limites atuais não foram confirmados. Nenhuma mensagem foi enviada e nenhuma conta foi conectada.

## Licença e origem

Preservar LICENSE MIT e copyright Pablo De Lucca. Personagens creditados pelo upstream a JIK-A-4 / Metro City; não remover créditos e verificar a licença de cada pacote antes de redistribuição comercial. Não incluir packs externos sem verificar permissões.

Fontes: https://github.com/pixel-agents-hq/pixel-agents ; https://github.com/pixel-agents-hq/pixel-agents/pull/228 ; https://learn.chatgpt.com/docs/app-server
