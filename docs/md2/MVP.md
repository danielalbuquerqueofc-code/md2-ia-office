# Como ligar o MVP operacional

O MVP roda **sem IA real** por padrão (`MD2_WORKER=simulated` gera rascunhos locais). A primeira
execução com Codex (`MD2_WORKER=codex`) e qualquer contato externo exigem autorização separada.

Comandos em PowerShell, a partir da pasta do repositório.

## 1. Compilar

```powershell
npm run build
```

## 2. Criar a credencial do operador

Escolha um segredo longo (gerenciador de senhas). O script lê da entrada padrão e imprime só o
hash; nada é gravado. Digite o segredo, `Enter`, depois `Ctrl+Z` e `Enter`:

```powershell
node scripts/md2-operator-credential.cjs
```

## 3. Criar o arquivo de operadores (fora do repositório)

Salve em `%USERPROFILE%\.pixel-agents\md2-operators.json`, colando em `credential` o JSON do
passo 2. Exemplo com um único operador (CEO, revisor e operador):

```json
{
  "version": 1,
  "operators": [
    {
      "subjectId": "daniel",
      "roles": ["ceo", "reviewer", "operator"],
      "permissions": [
        "director.submit",
        "director.read",
        "queue.read",
        "queue.operate",
        "approval.decide"
      ],
      "scopes": [{ "clientId": "md2", "projectId": "piloto-comercial" }],
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

Restrinja o acesso (o servidor recusa o arquivo se outra identidade puder lê-lo):

```powershell
$sid = ([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
icacls "$env:USERPROFILE\.pixel-agents\md2-operators.json" /inheritance:r /grant:r "*${sid}:F" "*S-1-5-18:F"
```

## 4. Ligar o servidor com a fila protegida

```powershell
$env:MD2_EXECUTOR_ENABLED = '1'
$env:MD2_OPERATORS_FILE = "$env:USERPROFILE\.pixel-agents\md2-operators.json"
$env:MD2_CLIENT_ID = 'md2'
$env:MD2_PROJECT_ID = 'piloto-comercial'
$env:MD2_WORKER = 'simulated'
npm run md2
```

Opcionais: `MD2_DATA_ROOT` (padrão `%USERPROFILE%\.pixel-agents\md2-data`, fora do repositório),
`MD2_TASK_MAX_TOKENS`, `MD2_TASK_MAX_COST_MICROS`, `MD2_BUDGET_MAX_TOKENS`,
`MD2_BUDGET_MAX_COST_MICROS`. Se algo estiver errado, o log mostra `[MD2] Executor desativado:
<código>` e nada executa.

O terminal mostra `http://127.0.0.1:<porta>/?token=<token>`. Abra esse endereço para ver o
escritório (a linha "Fila MD2" aparece no painel). Para a API, use o token como `Bearer`.

## 5. Usar a API (exemplo)

```powershell
$base = 'http://127.0.0.1:<porta>/api/md2'
$gate = @{ Authorization = 'Bearer <token do servidor>' }
$login = Invoke-RestMethod "$base/operator/login" -Method Post -Headers $gate -ContentType 'application/json' -Body (@{ subjectId = 'daniel'; secret = (Read-Host 'Segredo') } | ConvertTo-Json)
$h = $gate + @{ 'x-md2-session' = $login.token }

# Piloto comercial
$lead = Invoke-RestMethod "$base/pilot/leads" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ reference = 'clinica-sol-001'; company = 'Clínica Sol'; role = 'Diretora'; segment = 'saúde'; source = 'indicacao'; need = 'Organizar a captação de pacientes' } | ConvertTo-Json)
Invoke-RestMethod "$base/pilot/leads/$($lead.lead.id)/classify" -Method Post -Headers $h
Invoke-RestMethod "$base/pilot/leads/$($lead.lead.id)/messages" -Method Post -Headers $h -ContentType 'application/json' -Body '{"kind":"first-contact"}'

# Fila com aprovação humana
$d = Invoke-RestMethod "$base/demands" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ requestId = 'req-001'; title = 'Qualificar Clínica Sol'; description = 'Avaliar a necessidade descrita pelo operador'; intent = 'commercial.qualify' } | ConvertTo-Json)
$q = Invoke-RestMethod "$base/queue" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ demandId = $d.demand.id } | ConvertTo-Json)
$a = Invoke-RestMethod "$base/queue/$($q.item.id)/approval" -Method Post -Headers $h   # mostra ação exata e digest
Invoke-RestMethod "$base/queue/$($q.item.id)/approval/$($a.requestId)/decide" -Method Post -Headers $h -ContentType 'application/json' -Body (@{ decision = 'approve'; secret = (Read-Host 'Segredo') } | ConvertTo-Json)
Invoke-RestMethod "$base/executor/run-next" -Method Post -Headers $h -ContentType 'application/json' -Body '{"wait":true}'
Invoke-RestMethod "$base/queue-state" -Headers $h
```

## Desligar

Feche o servidor ou remova `MD2_EXECUTOR_ENABLED`. Sem a flag, o comportamento antigo volta e as
rotas novas não existem. Sessões ficam só em memória e terminam ao reiniciar.

Referências: `OPERATORS.md`, `QUEUE.md`, `EXECUTOR.md`, `PILOT.md`.
