# MD2 IA Office — base oficial Pixel Agents 1.5

A implementação usa o repositório oficial https://github.com/pixel-agents-hq/pixel-agents no commit b1bafd02896d90d83457266575a1e8e5011ce997 (1.5.0). O escritório, personagens, móveis, editor e transporte WebSocket são os originais. A integração MD2 é um acréscimo ao modo standalone; a antiga PR #228 não foi aplicada à nova arquitetura. A branch anterior md2/primeira-versao continua preservada.

## Abrir o escritório

Requisitos: Node.js 20+, Codex CLI instalado e autenticado com a conta que você deseja usar. Esta versão usa o app-server local do Codex; não cria uma chave de API.

1. Instale as dependências com `npm ci` na raiz.
2. Compile com `npm run build`.
3. Execute `npm run md2`.
4. Abra o endereço de operador exibido no terminal. Ele contém uma credencial de acesso: não compartilhe essa URL.
5. No painel **MD2 IA OFFICE**, descreva uma tarefa e clique em **Executar tarefa**.

A pasta atual do processo é a pasta onde o programador trabalha. Para escolher outra, defina `MD2_WORKSPACE` antes de iniciar. Em PowerShell:

```powershell
$env:MD2_WORKSPACE = 'C:/caminho/do/seu/projeto'
npm run md2
```

Se o executável Codex não estiver no PATH, defina `MD2_CODEX_COMMAND` com seu caminho absoluto. O lançamento usa argumentos separados e não abre um shell para construir o comando. Não inclua credenciais em arquivos rastreados.

O modo MD2 é ativado somente pelo comando acima (`MD2_OFFICE_ENABLED=1`). O lançamento normal do Pixel Agents permanece sem execução MD2. `--no-terminal` também desativa o executor MD2. A integração MD2 nesta etapa funciona no navegador; o adaptador VS Code oficial foi preservado e não recebeu o novo painel.

## O que funciona

- Um programador Codex por vez. O personagem é criado após a conexão com uma sessão real; eventos de comandos e alterações alimentam as animações originais do escritório.
- Tarefas, respostas, estados e contagem de eventos reais, com histórico local persistente em `.md2-office/tasks.json`, na pasta de trabalho. Essa pasta é ignorada pelo Git.
- Centro de aprovações na própria interface. Pedidos de execução exibem o comando; pedidos de alteração exibem caminhos e conteúdo proposto. A aprovação fica bloqueada se não houver prévia suficiente.
- Decisão válida somente para um pedido. Repetição ou tentativa de responder a pedido encerrado retorna conflito. O pedido expira em dois minutos e é negado; não existe opção de aprovar todos ou aprovar para a sessão inteira.
- Cancelar tarefa encerra o processo Codex, invalida decisões pendentes e registra interrupção. Reiniciar o servidor não ressuscita tarefas ou personagens em execução.
- Apenas `turn.status=completed` conclui uma tarefa. Falha ou interrupção não é apresentada como sucesso.

## Limites de permissão

O app-server recebe explicitamente `approvalPolicy=untrusted`, `approvalsReviewer=user` e `sandbox=workspace-write`. Pedidos adicionais de permissões são negados e métodos de aprovação desconhecidos não recebem autorização. A configuração upstream de ignorar permissões não é aplicada às tarefas do painel MD2. Conexões de ferramentas da conversa-pai não são repassadas pelo ambiente; servidores MCP configurados são desativados no início da sessão. Isso não é uma garantia de isolamento de todo servidor ou ferramenta interna que uma versão do Codex possa carregar.

As rotas de tarefas, histórico e decisões exigem token de operador, Host permitido e, quando presente, Origin correspondente. O token não é passado ao processo Codex. O servidor deve permanecer em loopback para uso local. Este é um controle para uso pessoal, não um sistema multiusuário ou uma barreira contra programas maliciosos executando sob a mesma conta do Windows. As garantias do sandbox dependem do Codex e do sistema operacional. Ferramentas e ações que não gerem pedidos de aprovação seguem a política e o sandbox do Codex. Não conectar serviços externos sensíveis sem revisar essa superfície.

O botão **+ Agent** e as configurações originais pertencem ao fluxo Claude do upstream. As proteções descritas aqui se referem às tarefas iniciadas no painel **MD2 IA OFFICE**. Fechar visualmente um personagem não substitui **Cancelar tarefa** no painel.

O histórico inclui prompts, respostas e prévias de alterações; pode conter dados do projeto. Ainda não há criptografia do histórico, retenção automática, autenticação por pessoa, retomada de execução interrompida, limite de custos ou fila com vários agentes. Não há deploy nem WhatsApp conectado.

## Validação real em 23/10/2026

Foi usado o Codex local autenticado, em uma pasta de validação isolada:

1. Uma tarefa pelo navegador gerou `soma.js` e `soma.test.js`.
2. A alteração só foi aceita depois de a interface exibir a prévia dos dois arquivos.
3. Um pedido posterior expirou sem executar o comando solicitado, registrando interrupção.
4. Uma nova tarefa de executar `node --test soma.test.js` recebeu uma aprovação específica pelo navegador.
5. O Codex retornou saída 0 e dois testes aprovados; o painel registrou **Concluída**. Os dois testes também foram executados diretamente para verificar os arquivos produzidos.

A compilação passa. Os sete testes MD2 passam: eventos, falha, decisão pendente, persistência, repetição, expiração, cancelamento, acesso autenticado e bloqueio sem prévia. A suíte da interface oficial passou (195 testes). A suíte completa do servidor não está verde neste Windows: uma rodada registrou 670 aprovados e 54 falhas. A base oficial sem MD2 também apresentou falhas (656 aprovados e 53 falhas), com diferenças entre rodadas; comparações direcionadas estão no relatório de validação. Nas comparações direcionadas, os testes de diretórios falharam nos mesmos 16 casos em ambas as versões; os testes da CLI falharam em três casos na base e um na adaptação, sem falha exclusiva da adaptação nessas comparações. Não apresentar a suíte completa como aprovada. A auditoria de dependências da versão 1.5 apontou 11 vulnerabilidades (duas moderadas, oito altas e uma crítica); não houve atualização automática dessas dependências.

## Próximas etapas: sete departamentos e vinte agentes

| Departamento           | Funções previstas                                    | Quantidade |
| ---------------------- | ---------------------------------------------------- | ---------: |
| Diretoria e Estratégia | Direção de IA, Planejamento                          |          2 |
| Comercial e Vendas     | Prospecção, Qualificação, Propostas, Fechamento      |          4 |
| Marketing              | Estratégia, Conteúdo, Mídia                          |          3 |
| Operações              | Projetos, Design, Entregas                           |          3 |
| Atendimento            | Suporte, Retenção                                    |          2 |
| Financeiro             | Cobrança, Controle                                   |          2 |
| Tecnologia             | Programador Codex, Arquitetura, Automação, Qualidade |          4 |

Esses vinte agentes são planejamento, não vinte execuções ativas. Próximas etapas: organizar sete áreas no editor, associar personagens somente a sessões reais, separar responsabilidades e orçamentos, adicionar fila e limites de concorrência e fortalecer permissões antes de habilitar serviços externos.

WhatsApp começa pelo planejamento de conversas individuais, consentimento, webhooks autenticados e regras atuais de mensagens da Meta. Não prometer acesso a grupos comuns nem suporte a vinte participantes. A consulta anterior à documentação oficial de grupos retornou HTTP 429: elegibilidade e limites atuais precisam ser confirmados antes de implementar. Nenhuma mensagem foi enviada.

## Origem e licença

Preservados LICENSE MIT, copyright Pablo De Lucca e créditos dos personagens JIK-A-4 / Metro City do upstream. Manter as condições de cada pacote de assets na redistribuição. Esta adaptação não é uma publicação oficial do Pixel Agents.

Protocolo Codex: https://learn.chatgpt.com/docs/app-server. Os parâmetros de aprovação também foram conferidos no schema gerado pelo Codex instalado nesta máquina.
