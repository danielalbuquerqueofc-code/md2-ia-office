# Executor — Fase 03C-04 (worker simulado)

`Md2Executor` (`server/src/md2/executor.ts`) conduz **uma** tarefa por vez pelo protocolo de
lease da fila. Ele não inicia processo, modelo, rede nem agente: o worker é injetado pelo host
confiável. Nesta fase só existe worker simulado nos testes. Não há rota, interface ou ligação
com `httpServer.ts`.

## Contrato do worker

```ts
interface Md2Worker {
  run(input: WorkerInput, signal: AbortSignal): Promise<unknown>;
}
```

- `input` vem de `workerInputFromReservation` (ação exata da reserva, lease, tentativa,
  `deadlineAt`, alocação). O worker recebe uma cópia.
- O worker deve parar quando `signal` abortar. O retorno é validado por `validateWorkerResult`
  (IDs da tentativa, par resultado/motivo coerente, consumo `null` = desconhecido, saída redigida
  e limitada). Retorno inválido ou exceção = **sem resultado confiável**.

## Autorização

`runNext`, `cancel`, `recover` e `reconcile` exigem sessão de operador (`Md2OperatorAuth`) com
`queue.operate` no cliente/projeto exato do executor. Leitura (`queue.read`), outro escopo,
token inválido ou ausente são negados antes de qualquer reserva. O operador que iniciou fica
registrado no journal. O executor também confere que o armazenamento é do mesmo escopo.

Só os tipos `internal.analyze` e `internal.draft` são executados; qualquer outro é devolvido sem
iniciar.

## Protocolo de execução

1. `reserveNext` (aprovação, orçamento e lease na mesma revisão; limite global de 1).
2. Montagem da entrada e renovação do lease. Falha aqui = **não iniciado** → `release`.
3. **Marcador `started`** gravado de forma durável (evento `executor-*`, `md2.executor.v1`).
   O worker só é chamado depois que essa escrita confirma.
4. Execução com:
   - heartbeat periódico (padrão: 1/3 do lease) — falha de renovação = **lease perdido**;
   - prazo: o worker é parado `settleMarginMs` antes de `deadlineAt`, para o encerramento caber
     no lease;
   - cancelamento local pelo operador.
     Ao parar, o executor espera `abortGraceMs` pelo retorno; depois, trata como sem resultado.
5. O resultado validado é gravado no journal (`result`, saída até 12 000 caracteres) **antes**
   de alterar a fila, servindo de evidência para reconciliação.
6. Encerramento:

| Situação                                  | Ação na fila                                              |
| ----------------------------------------- | --------------------------------------------------------- |
| `completed`                               | `confirm` com o consumo informado                         |
| `failed` (inclui `TIMEOUT` informado)     | `fail` — terminal, sem nova tentativa automática          |
| `not-started` (atestado pelo worker)      | `release` — volta à fila com nova tentativa e aprovação   |
| `cancelled` após cancelamento do operador | `cancel` + `reconcile('cancelled')` com o consumo         |
| sem resultado / `unknown` / inválido      | `requireReconciliation` (ou `cancel` se foi cancelamento) |
| **lease perdido**                         | **nada**: journal `uncertain`, item fica para reconciliar |

Com lease perdido, outra parte pode já estar agindo sobre o item; o executor nunca confirma,
falha ou libera nesse caso, mesmo que o worker diga que terminou.

## Consumo

O consumo informado é gravado como medido. `null` permanece `null`: o `Md2Limits` marca a
reserva como desconhecida e **bloqueia novas reservas do projeto** até `Md2Limits.reconcile` com
medição confiável. Nada é estimado.

## Reinício e reconciliação

`recover(token)` chama `queue.recover()` (leases vencidos ou de outro dono →
`reconciliation_required`) e, para cada item do próprio armazenamento:

- **sem marcador `started`** para a tentativa → prova de não início → `reconcile('not-started')`
  e o item volta à fila;
- **com marcador** (ou evidência ilegível) → `uncertain`, com o resultado informado pelo worker
  quando houver. O item mantém a exclusão global até o operador chamar
  `reconcile(token, id, leaseId, resultado, consumo)`.

Tentativas que possam ter começado **nunca** são repetidas automaticamente.

## Garantias e limites

- No máximo uma execução por vez no processo (trava global do `Md2Limits`) e uma por executor
  (`EXECUTOR_BUSY`).
- O marcador de início é gravado antes de qualquer efeito; **não há garantia de execução
  exatamente uma vez**. A garantia é: no máximo uma execução automática por tentativa e repetição
  só com prova de não início.
- Promessas JavaScript não podem ser interrompidas: um worker que ignora o sinal continua rodando
  em segundo plano, embora seu resultado seja descartado. O worker real (03C-05) precisa encerrar
  o processo filho e sua árvore.
- O journal e as renovações aumentam o arquivo de armazenamento (limite de 10 000 registros).
- Um único processo escritor; sem coordenação entre processos.
- O worker simulado não acessa rede, arquivos nem o repositório. Diretório isolado por tentativa,
  sandbox e encerramento de processos ficam para 03C-05.
