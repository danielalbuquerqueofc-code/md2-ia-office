# MD2 — armazenamento local (Fase 02C)

Esta camada é independente do executor e não é conectada às rotas nesta fase.
Importar o módulo não abre arquivos, cria sessões ou inicia agentes. `initialize()`
persiste somente os estados inativos das 22 identidades do registro empresarial.

## Formato e escopo

Sem dependência SQLite no projeto, foi mantido JSON local com esquema estrito,
`schemaVersion: 1`, revisão monotônica, timestamps ISO e checksum SHA-256.
Cada cliente/projeto possui seu próprio arquivo:
`.md2-office/storage/<sha256-do-escopo>/state-v1.json`.
Os identificadores são validados e o documento também deve corresponder ao escopo
solicitado. A separação é física/lógica; não substitui autorização por usuário.
Links simbólicos nos caminhos de armazenamento são recusados.

Os registros são tipados: agentes empresariais, tarefas, eventos e aprovações.
Timestamps são gerados pelo armazenamento; IDs são informados pelo chamador e
permanecem estáveis. As transições são validadas, eventos são imutáveis, tarefas
encerradas não podem ser reabertas e decisões encerradas não podem ser alteradas.
Alterar o comando/conteúdo de uma aprovação exige outro ID. Não há concessão de
permissão de execução: o armazenamento apenas registra dados. Há no máximo uma
tarefa em `running`/`approval` e um agente `busy` por escopo; o executor existente
continua com seu limite de um, sem alterações.

## Escrita e recuperação

`read()` não cria arquivos. `initialize()` é idempotente. `commit(changes, revision)`
aplica alterações de forma indivisível e recusa revisão desatualizada. Todas as
instâncias do mesmo arquivo no processo compartilham uma sequência de operações;
cada operação relê o disco. O chamador deve reler antes de repetir um conflito.

A escrita cria `.pending` exclusivamente, grava e sincroniza os bytes, salva o
último documento válido em `.backup` por renomeação atômica e renomeia `.pending`
para o arquivo principal. Arquivos temporários nunca são truncados/reutilizados.
Em sistemas POSIX, o diretório também é sincronizado. No Windows a sincronização
do diretório não está disponível por esta API; permanecem os limites de durabilidade
do sistema de arquivos e hardware. Uma falha após renomear pode ter confirmado a
escrita: releia o estado em vez de repetir a operação cegamente.

JSON inválido, checksum divergente, esquema desconhecido ou referências inválidas
bloqueiam a leitura/escrita sem sobrescrever o arquivo. Uma gravação `.pending`
bloqueia novas escritas, mesmo quando o principal ainda pode ser lido.
`inspectRecovery()` informa apenas quais candidatos são válidos. Recuperação nunca
é automática: `recover('pending')` exige a revisão seguinte ao estado principal
(ou ao backup se o principal estiver ausente); `recover('backup')` restaura a última
cópia válida. Ambos preservam os bytes originais do principal/pendente em arquivos
`.preserved-*`, publicam uma nova revisão e preservam o candidato de recuperação.
Restaurar backup pode retornar um estado anterior; os bytes substituídos continuam
arquivados para revisão. Arquivos `.backup-*` e `.recovery-*` de falhas intermediárias
são preservados para inspeção manual, sem seleção automática.

A garantia de serialização é **dentro de um processo**. O arquivo pendente exclusivo
detecta algumas disputas entre processos, mas não é um protocolo de coordenação
multiprocesso. Usar somente um processo escritor e disco local, sem pasta de rede.
Checksum detecta corrupção acidental; não autentica conteúdo contra adulteração
por alguém com acesso à mesma conta do sistema operacional.

## Limites, retenção e dados sensíveis

Os limites configuráveis padrão são 10 MiB por documento, 64 KiB por registro,
10.000 registros no total e retenção de 90 dias. Exceder limites recusa a operação;
reduzir limites não remove dados existentes. A retenção apenas informa candidatos
de tarefas encerradas e seus eventos/aprovações encerradas. Não existe expurgo
automático ou API de exclusão. Backups e arquivos preservados exigirão política
própria de arquivamento; não são apagados nesta fase.

O esquema não aceita campos arbitrários, credenciais, ambiente ou configurações
de provedores. Desde a Fase 02D, novos textos passam por redação de formatos comuns
de credenciais antes da escrita; o validador ainda recusa padrões residuais que
reconheça, sem incluir o conteúdo no erro. Históricos existentes não são varridos.
Essa detecção não reconhece todos os segredos possíveis: o chamador deve fornecer
conteúdo revisado e sem credenciais.
Não há criptografia em repouso; usar ACLs apropriadas no Windows. Arquivos novos
usam modo `0600` e diretórios novos `0700` onde o sistema respeita esses modos.

## Histórico legado e próximo checkpoint

`.md2-office/tasks.json` continua pertencendo ao executor atual. Não é importado,
reescrito, renomeado nem substituído pela nova camada. `inspectLegacy()` é somente
uma leitura estrutural de contagens para preparar futura migração. Ela não valida
integralmente os registros legados nem os devolve à interface. Uma migração futura
precisará de consentimento de escopo, mapeamento `codex-programmer` → identidade
empresarial, validação de conteúdo sensível e backup verificável. Nenhuma migração
ou ligação ao executor foi executada na 02C.

Checkpoint 02D: revisar o contrato desta camada e autorizar explicitamente o próximo
escopo antes de conectar consumidores, migrar dados ou iniciar orquestração.
