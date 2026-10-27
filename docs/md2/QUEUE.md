# Fila persistente e distribuição — Fase 03B

`Md2Queue` é uma API interna do host confiável. Não inicia agentes, processos ou
modelos, não cria temporizadores/agendador e não chama serviços externos. Uma
reserva é somente um registro; não é confirmação de execução ou gasto real.

## Entrada, identidade e isolamento

`enqueue(demandId, context)` relê a demanda por `Md2Director.getForDistribution`.
Exige sessão autenticada do solicitante original, permissão `director.submit`,
escopo correspondente e demanda `classified`. Leitura isolada não autoriza
enfileiramento. Demandas ambíguas, redigidas ou bloqueadas não são distribuídas.
O responsável/capacidade vem da classificação validada contra o registro dos 22
agentes. Concessões são verificadas novamente; sua ausência mantém o item bloqueado.

Cada demanda gera no máximo um ID estável de trabalho por cliente/projeto.
Repetir `enqueue`, inclusive após reinício ou resposta perdida, devolve o item
existente sem zerar tentativas, reabrir um item terminal ou substituir histórico.
O recebimento de Carlos continua intacto. O novo registro de tarefa usa a identidade
do responsável e estado nativo `created`; os estados de distribuição abaixo são
mantidos em eventos imutáveis `md2.queue.v1`. Sem executor nesta fase, a fila é a
fonte do estado de distribuição e não altera os estados de execução/visuais.

`get(id, context)` valida leitura pelo diretor e solicitante original. Os métodos de
worker e reconciliação são privilegiados: o host deve autenticar e autorizar quem os
invoca antes de expor qualquer futura rota. Não aceitar políticas, orçamento,
identidade de processo ou provas de reconciliação vindas do próprio agente.

## Estados e ordem

| Estado                  | Significado                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| queued                  | Disponível para uma tentativa de reserva, sem permissão automática de executar |
| blocked                 | Falta concessão, aprovação, orçamento ou reconciliação de consumo              |
| reserved                | Uma reserva ativa com ID, tentativa, proprietário e expiração                  |
| reconciliation_required | Reserva vencida, de processo anterior ou cancelada com resultado pendente      |
| completed               | Resultado concluído confirmado pelo host                                       |
| failed                  | Falha confirmada ou teto de tentativas atingido                                |
| cancelled               | Cancelamento confirmado sem resultado pendente                                 |

`reserveNext()` escolhe, dentro do escopo, prioridade `high`, `normal`, `low` e,
depois, criação. Empates preservam a ordem persistida dos eventos de entrada. Uma
tarefa já reservada não é interrompida por outra urgente. Itens bloqueados são
reavaliados quando o host chama novamente o método; não existe loop de agendamento.
Um item sem autorização pode ser ultrapassado por outro elegível. Não há política
de justiça ou ordenação global entre projetos; há exclusão global de reservas.

## Reserva, autorização e orçamento

O padrão é lease de 60 segundos e no máximo 3 tentativas por item, configuráveis
(lease até 24 horas; tentativas de 1 a 100). O teto gravado no item não aumenta
quando outra instância usa configuração mais permissiva. Os tetos de tarefa,
agente/projeto e orçamento de `Md2Limits` continuam aplicáveis e podem bloquear antes.

Antes da reserva, a política verifica uma ação interna exata com agente, capacidade,
escopo, recurso, conteúdo, prioridade e identificador da tentativa. Ações externas
ou executáveis não são introduzidas pela fila. Quando a política exige aprovação,
o host obtém a ação com `actionForNextAttempt`, solicita/decide pelo fluxo de
`Md2Policy` e associa a aprovação com `attachApproval`. Alteração de parâmetros,
expiração, revisor revogado ou reutilização impedem a reserva. `renewApproval`
permite ao operador preparar outra revisão com novo ID, sem reiniciar tentativas.

O consumo único da aprovação, a reserva de orçamento e o lease são gravados na
**mesma revisão do armazenamento**. Uma falha não confirma apenas parte deles.
Orçamento ausente/expirado/esgotado mantém o item bloqueado, sem consumir tentativa
ou aprovação. Cada reserva efetiva conta como tentativa, mesmo se depois liberada.
A verba reservada não é apresentada como gasto medido.

Todas as instâncias compartilham exclusão de reserva no processo, incluindo filas
de outros projetos. O bloqueio de `Md2Limits` continua em **1** e é compartilhado
também com consumidores diretos dessa camada. Nenhum agente é ativado pela fila.

## Encerramento e recuperação

`confirm` e `fail` exigem o ID exato de um lease ativo do processo atual, antes da
expiração, e registram consumo conhecido ou `null`. Dados desconhecidos continuam
desconhecidos: a reserva correspondente permanece comprometida e novas tarefas
daquele projeto são bloqueadas até medição/reconciliação confiável.

`release(..., 'not-started')` exige atestação explícita de que nada começou. Registra
zero medido somente nessa condição, devolve o item à fila e preserva a contagem.
Ao atingir o teto, o item termina em falha. Uma falha normal é terminal; não há
reprocessamento automático. A próxima tentativa exige nova ação/aprovação.

Cancelar um item ainda não reservado é definitivo e idempotente. Cancelar um lease
ativo apenas marca `reconciliation_required`, retendo a exclusão e o orçamento.
Não há sinal de cancelamento enviado a processo externo nesta fase.

`recover()` e o início de `reserveNext()` inspecionam os manifests persistidos de
todos os projetos nas raízes de dados registradas. Leases vencidos ou com outro
identificador de inicialização passam a `reconciliation_required`; **nunca voltam
automaticamente à fila**. Uma reserva de orçamento sem lease correspondente também
bloqueia novas reservas e é informada como órfã. Não existe reparo automático de
JSON, migração ou exclusão de histórico. Um manifesto inválido bloqueia a recuperação.

`reconcile` exige identificação do lease e conclusão confiável: `not-started`,
`completed`, `failed`, `cancelled` ou `unknown`. Resultado `unknown` mantém o item e
a exclusão retidos. Somente prova de que não começou permite reenfileirar; os demais
resultados encerram o item. Custo desconhecido não é convertido em estimativa.
Se a confirmação de escrita se perder, consultar o estado antes de repetir: um
lease persistido continua retido, e um encerramento já persistido pode ser
reconhecido idempotentemente para sincronizar o bloqueio em memória.

## Limitações e próximo checkpoint

A recuperação descobre os projetos no catálogo `.md2-office/storage` de cada raiz
registrada. O host deve registrar **todas** as raízes gerenciadas, via instâncias da
fila ou `recoveryRoots`, antes de aceitar reservas. Não se procura pelo computador
inteiro; raízes omitidas não são descobertas. Inventário de recuperação é uma API
privilegiada e não deve expor dados de outros clientes a sessões comuns.

A coordenação entre **múltiplos processos** ainda não é garantida. Usar um único
processo escritor, disco local e identificador de inicialização consistente por
processo (padrão gerado em memória). Lease não é cerca de execução distribuída;
03C deverá validar novamente sua validade antes de qualquer operação e reconciliar
todos os resultados pendentes. Não há garantia de exatamente uma execução externa.

Permanecem os riscos de armazenamento sem criptografia, ACLs do Windows, redação
heurística e relógio do host. APIs de encerramento pressupõem informação verdadeira
do host; o sistema não observa efeitos externos porque não os executa nesta fase.

Checkpoint 03C: revisar o contrato do worker, autenticação de operadores e protocolo
de início/encerramento. Executor Codex, aprovações atuais, interface, integrações,
chamadas de IA e produção permanecem fora desta etapa, aguardando autorização.
