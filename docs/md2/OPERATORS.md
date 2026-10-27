# Operadores e sessões — Fase 03C-03

`Md2OperatorAuth` (`server/src/md2/operatorAuth.ts`) identifica operadores **no servidor**.
Nesta fase não existe rota de login, página, cookie ou integração com `routes.ts`: a API é
interna e será exposta somente em checkpoint posterior, com autorização.

## Princípios

- A identidade, os papéis, as permissões e os escopos vêm **apenas** do arquivo de operadores.
  O cliente apresenta somente um token de sessão opaco. Campos como `subjectId`, `role` ou
  `scopes` enviados pelo cliente são ignorados.
- O token compartilhado do servidor (`server.json` / `?token=`) **não** é identidade de operador
  e não é aceito por este módulo.
- Negação por padrão: uma permissão só vale se estiver listada explicitamente para o operador
  **e** for permitida por um dos seus papéis. Escopos são pares exatos cliente/projeto; não há
  curinga.

## Papéis e permissões

| Papel    | Permissões que o papel pode conceder       |
| -------- | ------------------------------------------ |
| ceo      | director.submit, director.read, queue.read |
| operator | queue.read, queue.operate                  |
| reviewer | approval.decide, queue.read, director.read |

Um arquivo que liste permissão fora dos papéis do operador é rejeitado
(`OPERATOR_PERMISSION_EXCEEDS_ROLE`). Campos desconhecidos também rejeitam o arquivo inteiro.

## Arquivo de operadores

```json
{
  "version": 1,
  "operators": [
    {
      "subjectId": "daniel",
      "roles": ["ceo", "reviewer"],
      "permissions": ["director.submit", "director.read", "approval.decide"],
      "scopes": [{ "clientId": "cliente-exemplo", "projectId": "projeto-exemplo" }],
      "credential": {
        "algorithm": "scrypt",
        "N": 32768,
        "r": 8,
        "p": 1,
        "salt": "...",
        "hash": "..."
      }
    }
  ]
}
```

- `credential` é gerado por `hashOperatorSecret(segredo)`: scrypt com sal aleatório de 16 bytes.
  **O segredo nunca é gravado**; o arquivo guarda só sal e hash. Segredo mínimo de 12 caracteres
  (recomendado: frase longa gerada por gerenciador de senhas).
- Guarde o arquivo **fora do repositório** (por exemplo, `%USERPROFILE%\.pixel-agents\`), nunca
  em `.md2-office/` versionado ou pasta sincronizada.
- `loadOperatorConfig(arquivo)` verifica a proteção do arquivo **antes** de lê-lo e falha fechado.

### Windows: ACL, não modo 0600

No Windows os bits POSIX (0600) **não** são considerados proteção. O carregador lê a ACL real
(`Get-Acl`, identidades convertidas para SID, independente do idioma do sistema) e só aceita:

- dono = conta atual, SYSTEM (`S-1-5-18`) ou Administradores (`S-1-5-32-544`);
- regras `Allow` apenas para essas mesmas identidades (regras `Deny` são aceitas).

Qualquer outra identidade (Todos, Usuários, Usuários autenticados, outra conta local, SIDs de
contêiner) bloqueia o carregamento com `OPERATOR_CONFIG_INSECURE`. Se a ACL não puder ser lida
(PowerShell indisponível, tempo esgotado, caminho com mais de 260 caracteres), o resultado é
`OPERATOR_CONFIG_ACL_UNVERIFIED` — nunca "aceito por omissão".

Arquivos criados em `%TEMP%` ou no perfil costumam **herdar** permissões de outras identidades.
Para restringir (substitua o caminho):

```powershell
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
icacls "C:\Users\<conta>\.pixel-agents\md2-operators.json" /inheritance:r /grant:r "*${sid}:F" "*S-1-5-18:F"
```

Em Linux/macOS o arquivo precisa ser do usuário do processo e ter modo sem acesso para grupo e
outros (`chmod 600`). Links simbólicos são recusados em todos os sistemas.

## Sessões

- Token de 256 bits (`randomBytes(32)`, base64url). O servidor guarda **somente o SHA-256** do
  token, em memória. Reiniciar o servidor revoga todas as sessões.
- Expiração absoluta de 8 h e por inatividade de 30 min (configuráveis, com limites). Atividade
  renova só a inatividade; a expiração absoluta nunca é estendida, nem pela rotação.
- `rotate` emite novo token para a mesma sessão e invalida o anterior; concessões de aprovação
  pendentes são descartadas.
- `revoke`, `revokeOperator` e `revokeAll` encerram sessões. Remover um operador ou trocar sua
  credencial no arquivo (`reload`) invalida as sessões existentes dele.
- No máximo 5 sessões por operador; a mais antiga é descartada.
- Falhas de autenticação: 5 tentativas em 15 min bloqueiam o operador por 15 min. Operadores
  inexistentes recebem o mesmo erro e o mesmo custo de derivação de chave.

## Aprovações sensíveis

Aprovar exige reautenticação recente vinculada ao **digest exato** da ação:

1. `reauthenticateForApproval(token, segredo, digest, escopo)` confere de novo o segredo do dono
   da sessão, a permissão `approval.decide` e o escopo, e cria uma concessão de 5 min.
2. `consumeApprovalGrant(token, digest, escopo)` consome a concessão (uso único) e devolve o
   `reviewerId`, que o host passa a `Md2Policy.decide`. Outro digest, outro escopo, concessão
   vencida ou já usada → `OPERATOR_REAUTH_REQUIRED`.

`reviewerIds()` fornece a lista de revisores para `Md2Policy`.

## Diretor

`directorAuthenticator()` devolve um `DirectorAuthenticator` que lê apenas `context.sessionToken`,
valida a sessão e monta o principal a partir do arquivo (papel `ceo`, permissões `director.*`
concedidas, escopos configurados, expiração da sessão).

## Logs

O módulo não escreve em console nem em logs. Erros carregam apenas códigos, sem token, segredo,
hash ou conteúdo do arquivo. Quem chamar `login`/`rotate` deve entregar o token ao operador uma
única vez e nunca registrá-lo.

## Limitações

- Sessões em memória: um único processo servidor; reinício encerra todas as sessões.
- Um operador com papéis `ceo` e `reviewer` pode aprovar a própria demanda. A reautenticação com
  digest reduz cliques acidentais, mas não substitui dois revisores distintos.
- A verificação de ACL no Windows usa Windows PowerShell 5.1 e não aceita caminhos com mais de
  260 caracteres (falha fechada). Ela verifica o arquivo, não a pasta que o contém.
- O bloqueio por tentativas é por `subjectId` e em memória; não há limitação por IP (não há rota).
- Proteção do segredo depende do operador; não há MFA nesta fase.
