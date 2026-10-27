# MD2 — políticas e limites (Fase 02D)

Esta camada é uma API interna para a futura orquestração. Não está conectada às
rotas, não inicia processos nem concede acesso a ferramentas externas. O executor,
suas aprovações, política `untrusted`, sandbox e limite de um permanecem intactos.

## Autorizações e aprovações

`Md2Policy` recebe configuração de um host confiável: cliente/projeto, concessões
explícitas por agente/capacidade/tipo de ação e revisores autorizados. O registro
de capacidades dos 22 agentes não concede execução. Sem concessão explícita, a
resposta é negativa. Mesmo com concessão, `local.execute` exige aprovação humana;
ações internas de análise/elaboração podem receber concessão específica sem revisão.

Operações externas, publicação, proposta final, compromisso comercial, gasto e
exclusão são sempre negados nesta fase. Nem uma aprovação consegue liberá-los.
Escopo da ação, recurso, tarefa e configuração precisam corresponder. A camada
trabalha com identificadores de recursos, não concede leitura arbitrária de arquivos.

Pedidos possuem UUID, tarefa, agente, escopo do armazenamento, fingerprint SHA-256
da ação integral e expiração (padrão: 2 minutos; máximo: 24 horas). O fingerprint
inclui parâmetros, recurso, capacidade, tipo, IDs e escopo; apenas a ordem das
propriedades JSON é irrelevante. Ações com credenciais reconhecidas são rejeitadas,
em vez de aprovar uma prévia redigida que represente uma ação diferente.

Solicitação, decisão e consumo são eventos persistentes. `decide` recebe a identidade
de um revisor e a ação exata; `consume` revalida concessão, revisor, expiração e
fingerprint. O consumo é persistido antes do retorno. Revisões do armazenamento
impedem duas instâncias de consumir o mesmo pedido. Um ID de ação não recebe outro
pedido; uma nova tentativa exige nova ação e revisão. Reiniciar não libera pedidos
consumidos ou negados. A expiração é verificada no acesso, sem temporizador.

O host futuro deve autenticar o operador antes de chamar `decide`: um nome informado
pelo agente ou pelo navegador não prova identidade. Concessões, revisores, orçamentos
e medições nunca devem vir do próprio agente. Estas APIs e a API de armazenamento
são privilegiadas; um código com acesso direto ao armazenamento pode adulterar
auditorias. Elas não são uma barreira contra código malicioso no mesmo processo.

O host também deve resolver a propriedade real dos recursos e classificar a ação
pela operação que será executada; não confiar em rótulos de tipo/escopo enviados
pelo agente. Esta camada não analisa semanticamente comandos shell para descobrir
acesso à rede ou caminhos de outros clientes. Essa verificação, o isolamento de
arquivos e a restrição de ferramentas pertencem ao adaptador de execução futuro.

## Limites e consumo

`Md2Limits` tem tetos configuráveis de tentativas, tokens e custo por tarefa, agente
e projeto. Valores são inteiros; custo usa **microunidades de USD** (1 USD = 1.000.000).
Os contadores são cumulativos e persistem como eventos, sem reinício automático de
período. Alterar o ID do orçamento não zera o consumo. Somente a configuração
confiável pode fornecer orçamento autorizado, com ID, escopo, teto e expiração.
Ausência, expiração, teto esgotado ou escopo divergente bloqueiam novas reservas.

Antes de qualquer futura execução, `reserve` exige uma reserva positiva de tokens
e custo e verifica os três níveis de limite e o orçamento autorizado. Todas as
instâncias compartilham um bloqueio de concorrência de **1** neste processo, mesmo
em projetos diferentes. Não há fila, espera agendada ou repetição automática.
Tentativas já reservadas contam mesmo se a tarefa falhar. A reserva não é custo real.

`settle` registra medições reais fornecidas por uma fonte confiável. Quando não há
medição, usar `null`: o relatório separa consumo conhecido, desconhecimento e saldo
reservado. Nunca converte reserva/estimativa em consumo real. Consumo desconhecido
mantém a reserva comprometida e bloqueia novas tarefas do projeto. `reconcile`
exige medições conhecidas para resolver essa incerteza; números já medidos não podem
ser reduzidos. Um gasto real acima da reserva é registrado integralmente e impede
novas reservas que ultrapassem os tetos. Não existe controle físico de custo de um
provedor nesta fase: a reserva não garante que uma chamada respeite seu teto.

Uma reserva persistida não inicia nem retoma um agente. Após interrupção, uma reserva
não encerrada bloqueia novas reservas daquele projeto. Na Fase 03, o host deverá
reconciliar **todos os projetos** antes de abrir executores após um reinício e ligar
o executor atual ao mesmo bloqueio global. A descoberta de projetos, coordenação
entre processos e supervisão do executor não estão implementadas. Usar um único
processo escritor; não há garantia de concorrência global entre processos distintos.

## Dados sensíveis e riscos restantes

Novos prompts, saídas, resumos de aprovação e mensagens de eventos passam por
redação de formatos comuns (tokens, autorização HTTP, atribuições de senha/chave,
credenciais em URLs e chaves privadas) e remoção de controles. Campos extras
continuam proibidos pelo esquema. Campos imutáveis existentes não são reescritos;
o histórico legado e backups não são varridos ou modificados. Usar o prompt retornado
pelo armazenamento em atualizações seguintes: seu conteúdo já pode estar redigido.
A redação é heurística, não detecta todos os segredos ou dados pessoais e não torna
seguro persistir conteúdo arbitrário.

O JSON, backups e arquivos preservados não têm criptografia. No Windows, `0600`
não substitui ACLs: restringir a pasta à conta de operação e proteger backups.
O checksum detecta corrupção acidental, não adulteração por usuário com escrita.
As variáveis de ambiente herdadas pelo executor continuam sendo um risco: antes
de integrar novos executores, fornecer uma lista explícita de variáveis permitidas,
sem credenciais de outros clientes ou conexões da sessão-pai. O relógio do host deve
ser confiável para expiração; não há fonte externa de tempo nesta fase.

## Integração pendente — somente com autorização para a Fase 03

O futuro fluxo deverá compor: autenticação do operador → política e concessão →
aprovação da ação exata, quando exigida → reserva de limites/orçamento → consumo
único da aprovação → executor com suas próprias aprovações Codex → medição e
encerramento da reserva. Falhas entre essas etapas devem bloquear a execução e
requerer reconciliação; não reutilizar autorizações nem relançar automaticamente.
Nenhum retorno `allow` da política dispensa orçamento, limites ou aprovação Codex.
