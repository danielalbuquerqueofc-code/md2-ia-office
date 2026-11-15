# Carlos — recebimento e classificação determinística (Fase 03A)

`Md2Director` é um núcleo interno de recebimento, sem rota HTTP, interface nova,
modelo de IA, processo, integração externa ou encaminhamento. Não cria fila,
agendamento, concessões, aprovações executáveis nem reservas de orçamento.

## Contrato de identidade

O host deve fornecer `DirectorAuthenticator`, ligado a uma sessão realmente
autenticada. Não existe adaptador padrão, conta CEO criada automaticamente ou
conversão do token de operador do Codex em identidade pessoal. O resultado confiável
deve ter `subjectId`, papel `ceo`, permissões `director.submit`/`director.read`, escopos
autorizados e expiração. O contexto opaco da sessão é separado do corpo e não é
persistido. Os testes usam sessões reconhecidas por um WeakMap exclusivamente em
pastas temporárias; nenhuma identidade de produção é provisionada.

`receive(body, context)` valida identidade, permissão de envio e escopo. O corpo
aceita somente `requestId`, `scope`, `title`, `description` e os campos opcionais
`intent`, `urgency` e `requestedAction`. Identidade, papel ou agente responsável
informados no corpo são recusados. O escopo deve corresponder simultaneamente ao
diretor, ao armazenamento e à sessão autenticada. `get(id, context)` exige permissão
de leitura e o mesmo solicitante original, mesmo dentro de um projeto compartilhado.

## Classificação e responsabilidade

Sem `intent`, regras locais procuram palavras/expressões normalizadas sem acentos.
Nenhum resultado ou múltiplos resultados geram `needs_clarification`; Carlos mantém
a responsabilidade. Um `intent` estruturado conhecido resolve a escolha sem inferência
de linguagem natural. A tabela é estável e validada contra o registro empresarial:

| Intent                  | Responsável proposto | Capacidade            |
| ----------------------- | -------------------- | --------------------- |
| strategy.plan           | Carlos               | strategy.plan         |
| commercial.prospect     | Lucas                | leads.analyze         |
| commercial.qualify      | Fernanda             | leads.analyze         |
| commercial.proposal     | Rafael               | proposals.draft       |
| marketing.strategy      | Mariana              | campaigns.plan        |
| marketing.brand         | Beatriz              | campaigns.plan        |
| marketing.performance   | Gabriel              | marketing.analyze     |
| marketing.media         | Pedro                | campaigns.plan        |
| technology.code         | André                | code.draft            |
| technology.architecture | Camila               | software.design       |
| technology.automation   | Diego                | software.design       |
| technology.quality      | Sofia                | tests.plan            |
| support.triage          | Juliana              | support.triage        |
| support.relationship    | Bruno                | replies.draft         |
| finance.analysis        | Renata               | finance.analyze       |
| finance.report          | Eduardo              | finance.reports.draft |
| operations.plan         | Thiago               | projects.plan         |
| operations.review       | Amanda               | deliveries.review     |
| production.draft        | Isabela              | content.draft         |
| production.review       | Vinícius             | content.review        |
| legal.review            | Helena               | legal.review          |
| administration.organize | Patrícia             | records.organize      |

A prioridade padrão é `normal`; `urgency` aceita `low`, `normal` ou `high`.
Termos como “urgente”, “crítico” e “prazo hoje” elevam a prioridade para `high`.
Prioridade não inicia trabalho nem supera permissões. A classificação também retorna
o departamento real da identidade cadastrada, sem alterar os departamentos visuais.

`Md2Policy.assessAssignment` consulta concessões explícitas e escopo sem criar uma
autorização de execução. Carlos precisa de concessão de `work.review`/`internal.analyze`;
o responsável proposto precisa da capacidade e tipo interno correspondentes. Sem
concessão, a demanda fica `blocked`; se uma aprovação for exigida, fica
`approval_required`, sob responsabilidade de Carlos. Nenhuma aprovação é criada ou
consumida nesta fase. As APIs executáveis da política continuam exigindo tarefa e
agente correspondentes, aprovação quando exigida e consumo único.

Pedidos de execução, ações externas, publicação, proposta final, compromisso,
gasto ou exclusão ficam bloqueados. Algumas expressões sensíveis também acionam
bloqueio conservador, mesmo se o corpo declarar uma ação interna. Essas regras não
compreendem negação ou toda a semântica de texto e podem produzir falsos positivos.
Não são uma barreira de execução: o retorno sempre contém `executionAllowed: false`.

## Persistência, duplicidade e consulta

A demanda usa um ID estável derivado de cliente, projeto, solicitante autenticado
e `requestId`. Repetições da mesma entrada normalizada/redigida retornam a demanda
existente com `duplicate: true`. Reutilizar a chave com conteúdo diferente gera
conflito, sem sobrescrever histórico. Submissões concorrentes usam as revisões do
armazenamento; não há repetição de ações de agentes.

Uma única gravação cria um registro de tarefa de recebimento (`agentId: carlos`,
`status: created`) e dois eventos: `received` e o resultado da classificação. Esse
registro não é uma tarefa executável do agente indicado. Responsável, indicação,
prioridade, motivo, solicitante e histórico ficam nos metadados `md2.director.v1`;
timestamps são gerados pelo armazenamento. A consulta verifica consistência e não
reescreve arquivos. Falha de gravação não confirma recebimento; uma resposta perdida
após commit pode ser recuperada repetindo a mesma chave.

Novos textos passam pela redação existente; conteúdo redigido fica para esclarecimento.
O contexto autenticado e credenciais não são armazenados. A proteção é heurística,
e o armazenamento continua sem criptografia. Não há migração ou alteração do
`tasks.json` legado. O esquema de armazenamento existente permanece na versão 1.

O módulo de limites é consultado somente para observar consumo desconhecido do
projeto. Não há orçamento autorizado criado pelo diretor, nem reserva ou medição
inventada. Receber/classificar localmente não implica executar uma tarefa; uma
indicação anterior nunca dispensa nova validação de políticas e limites.

## Próximo checkpoint — 03B, somente após autorização

Ligar um adaptador de autenticação real e revisar os contratos de demandas e regras.
Antes de qualquer futuro encaminhamento, revalidar identidade, propriedade real dos
recursos, política, aprovação, orçamento e limite global; criar o item de trabalho
adequado ao agente somente no escopo autorizado. Interface, rotas, fila e execução
continuam fora da 03A. As aprovações e o executor Codex permanecem intactos.
