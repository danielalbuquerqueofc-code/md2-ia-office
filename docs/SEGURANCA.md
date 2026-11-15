# Segurança — auditoria e controles

Auditoria realizada em 15/11/2026 (operação noturna). Cada item traz a evidência que o sustenta. "Corrigido" significa implementado **e** coberto por teste automatizado ou por execução real registrada em `docs/RELATORIO_OPERACAO_NOTURNA.md`.

## Achados da auditoria

| # | Gravidade | Achado | Situação | Evidência |
|---|---|---|---|---|
| 1 | Alta | Comandos `Bash` dos agentes rodavam com as permissões do servidor: podiam escrever fora do workspace, ler workspaces de **outros clientes**, ler o banco SQLite e ler a chave da API. O guard de comandos é filtro, não isolamento. | **Corrigido** com o sandbox de SO do Claude Agent SDK (bubblewrap no Linux). | Teste real com tentativas de violação (tabela abaixo); `security.test.ts` |
| 2 | Alta | Escape por link simbólico: um agente podia criar `atalho -> /etc` e ler/escrever pelo atalho (guard) ou registrar `atalho/arquivo` como entregável, que seria servido pela interface. | **Corrigido**: guard e registro de entregáveis resolvem o caminho real. | `security.test.ts`, `recovery.test.ts` |
| 3 | Alta | DNS rebinding: em modo local sem senha, um site malicioso podia apontar o próprio domínio para 127.0.0.1 e usar a API. | **Corrigido**: cabeçalhos `Host` e `Origin` validados contra lista permitida (`MD2_ALLOWED_HOSTS`). | `http.test.ts` |
| 4 | Média | `echo $ANTHROPIC_API_KEY` no shell do agente expunha a credencial. | **Corrigido**: variáveis de credencial negadas dentro do sandbox (`credentials.envVars`) e padrão bloqueado no guard. | Teste real: variável vazia no sandbox; `security.test.ts` |
| 5 | Média | URL malformada (`/%E0%A4%A`) lançava exceção fora do tratamento de erros. | **Corrigido**: retorna 400. | `http.test.ts` |
| 6 | Média | A verificação do runtime fazia uma chamada paga ao modelo a cada 5 min enquanto a interface estivesse aberta (~US$ 0,19/h, ~US$ 4,60/dia). | **Corrigido**: verificação em cache; repete só sob demanda ou, após falha, a cada 2 min. | `claudeRuntime.ts`; botão "Testar conexão" |
| 7 | Média | Retentativas contavam custo em dobro (sessão retomada reporta custo acumulado). | **Corrigido**: só o excedente é contabilizado. | `recovery.test.ts` |
| 8 | Média | Anexo com o mesmo nome sobrescrevia o anterior na pasta `entrada/` do cliente. | **Corrigido**: nome único `arquivo (2).ext`. | `recovery.test.ts` |
| 9 | Média | Clique duplo em "Enviar ajustes" criava duas execuções. | **Corrigido**: identificador por pedido. | `recovery.test.ts` |
| 10 | Média | Recuperação após reinício sem limite: uma execução que derrubasse o processo seria retomada para sempre. | **Corrigido**: `MD2_MAX_RECOVERIES` por execução e tentativas por tarefa. | `recovery.test.ts`, teste real com SIGKILL |
| 11 | Média | Detecção do sandbox executava `socat --version` (não suportado) e desativava o isolamento com o socat instalado. Encontrado durante os testes reais desta noite. | **Corrigido**: procura o executável no PATH. | `security.test.ts` |
| 12 | Crítica (dev) | 3 vulnerabilidades em dependências de desenvolvimento (`vitest`/`tinypool`, 2 críticas). | **Corrigido**: Vitest 5.1. `npm audit`: 0 vulnerabilidades. | `npm audit` |
| 13 | Baixa | Mapa de tentativas de login crescia sem limite. | Corrigido (limpeza de expirados). | `auth.ts` |
| 14 | Baixa | Cookie de sessão sem `Secure` atrás de HTTPS. | Corrigido (`MD2_COOKIE_SECURE=1` ou `X-Forwarded-Proto: https`). | `auth.ts` |
| 15 | Baixa | Falta de `X-Content-Type-Options: nosniff` global. | Corrigido. | `app.ts` |

Verificados sem achados: shell injection no servidor (o único `spawnSync` chama binários fixos com argumentos fixos, sem shell); SQL dinâmico (só nomes de coluna definidos no código; valores sempre parametrizados); HTML na interface (Markdown renderizado como nós React, sem `innerHTML`); path traversal em `/files` (caminho resolvido e contido; testado); uploads (extensões permitidas, nome saneado, tamanho limitado, nunca servidos de volta).

## Isolamento das tarefas dos agentes

Cada tarefa é uma sessão independente do Claude Agent SDK com:

1. **Sandbox de sistema operacional** para todo comando `Bash` (bubblewrap + seccomp no Linux):
   - escrita permitida apenas no workspace da conversa;
   - leitura do diretório de dados (`MD2_DATA_DIR`) negada, exceto o próprio workspace; leitura de `.env`, `~/.claude`, `~/.ssh`, `~/.aws`, `~/.config`, `~/.gnupg`, `~/.netrc`, `~/.npmrc` negada;
   - variáveis `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN` e credenciais de nuvem negadas;
   - comandos fora do sandbox proibidos (`allowUnsandboxedCommands: false`);
   - acesso de rede de um comando passa pelo guard (`SandboxNetworkAccess`): hosts internos (127.0.0.1, 10.x, 192.168.x, 169.254.x…) são negados.
2. **Guard de permissões** (`guard.ts`) para as ferramentas que rodam no processo do runtime (Read, Write, Edit, Glob, Grep, WebFetch): escrita só no workspace, leitura só no workspace e pastas autorizadas, caminho real resolvido (links simbólicos), rede interna bloqueada, ferramentas fora da lista negadas. Cada bloqueio vira evento de segurança e entrada de auditoria.
3. **Ambiente limpo**: segredos de integração (`MD2_*`, `GITHUB_TOKEN`, `GOOGLE_OAUTH_*`, `INSTAGRAM_*`…) removidos do ambiente do agente; `TMPDIR` aponta para um diretório curto e próprio da conversa (`/tmp/md2-<id>`, modo 0700). Não fica dentro do workspace porque caminhos longos estouram o limite de sockets Unix — problema observado no teste real, em que o Chrome do QA não subia.
4. **Ações externas só com aprovação humana** (`solicitar_aprovacao`); nenhum conector externo executa ações nesta versão.

### Evidência do sandbox (teste real com o SDK, 15/11/2026)

O agente executou um comando que tenta, de uma vez, cada violação:

| Tentativa | Sem sandbox | Com sandbox |
|---|---|---|
| Escrever dentro do workspace | permitido | permitido |
| Escrever fora do workspace (`/home/user/...`) | permitido | **negado** — "Read-only file system" |
| Ler workspace de outro cliente | permitido | **negado** — arquivo invisível |
| Ler o banco `md2.sqlite` | permitido | **negado** — arquivo invisível |
| Ler a variável da chave de API | permitido | **negado** — variável vazia |
| Acessar a rede | livre | pedido de permissão roteado ao guard |

Configuração: `MD2_AGENT_SANDBOX=auto` (padrão: ativa quando suportado e avisa quando não), `required` (recusa executar sem isolamento — recomendado em produção) ou `off`.

### Riscos de isolamento que continuam abertos

- **`/tmp` continua gravável** dentro do sandbox (padrão do SDK). Mitigação: `TMPDIR` próprio por conversa; um comando que escreva explicitamente em `/tmp` ainda pode deixar arquivos visíveis para outra tarefa.
- **Ferramentas de arquivo do runtime (Read/Write/Edit) não passam pelo sandbox de SO**, só pelo guard. O guard foi endurecido (caminho real) e testado, mas é controle de aplicação.
- **Validado só no Linux.** macOS e Windows constam como "não verificado"; em `auto`, sem suporte confirmado, o sistema avisa na interface e roda só com o guard.
- **O processo servidor em si não é isolado.** Para operação exposta à internet, rode-o em contêiner ou usuário dedicado. Exemplo de unidade systemd com endurecimento (fornecido como referência, **não testado** neste ambiente, que não tem systemd nem daemon Docker):

```ini
[Service]
User=md2
WorkingDirectory=/opt/md2-ia-office
EnvironmentFile=/opt/md2-ia-office/.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/opt/md2-ia-office/data /opt/md2-ia-office/backups /tmp
PrivateTmp=yes
```

## Plataformas

O isolamento de SO (bubblewrap + socat) só foi validado em **Linux**. No **Windows nativo** ele é indisponível e a validação comercial não vale; use WSL2 (não testado) ou anexe os arquivos pela interface a um servidor Linux. macOS não foi verificado.

## Autenticação e autorização

- Sem `MD2_ADMIN_PASSWORD`, o servidor só aceita `127.0.0.1`; definir outro host sem senha impede a inicialização.
- Com senha: cookie de sessão assinado (HMAC-SHA256, chave aleatória em `data/session.key`, permissão 0600), `HttpOnly`, `SameSite=Strict`, 7 dias; 5 tentativas erradas por IP bloqueiam por 10 min; comparação em tempo constante.
- Toda rota `/api/*` (exceto `health`, `session` e `login`) e todo `/files/*` exigem sessão. Mutações exigem o cabeçalho `x-md2: 1` (anti-CSRF) e `Origin` permitido.
- Usuário único (administrador). **Não há perfis nem permissões por usuário** — risco aberto para uso por equipe.

## Credenciais

- Só no `.env` (ignorado pelo git; `.gitleaks.toml` presente). Nunca no frontend: `/api/settings` mostra nomes de variáveis, não valores (testado).
- Logs passam por mascaramento de chaves `sk-ant-…`, tokens GitHub/Google/Meta, `Bearer …` e campos `password/token/secret/api_key/authorization/cookie` (testado em `security.test.ts`).

## Trilha de auditoria

Tabela `audit` (consultável em Histórico → Auditoria): login e tentativas recusadas, mensagens, uploads, cancelamentos, decisões de aprovação e de entregáveis, verificação do runtime, backups manuais, **bloqueios do guard por agente** e falhas críticas do sistema. Limitação: quem tem acesso ao arquivo do banco pode alterá-la (não há assinatura encadeada).

## Prompt injection

Todo prompt (Alfred e agentes) declara que conteúdo de sites, arquivos e ferramentas é dado, nunca instrução. A defesa efetiva é estrutural: mesmo um agente manipulado não consegue publicar, enviar, gastar ou excluir fora do workspace, porque essas ações não existem sem aprovação humana e o sandbox impede acesso a outros clientes e credenciais. Não é possível garantir que um agente nunca seja induzido a erro dentro do próprio workspace.
