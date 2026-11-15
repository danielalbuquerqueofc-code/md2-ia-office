# Backup, recuperação e monitoramento

## O que é protegido

| Dado | Onde vive | Como é copiado |
|---|---|---|
| Banco (conversas, execuções, tarefas, eventos, entregáveis, aprovações, auditoria) | `data/md2.sqlite` | Snapshot online e consistente (API de backup do SQLite), com SHA-256 e `PRAGMA integrity_check` |
| Versões de entregáveis | `data/deliverables/<id>/v<n>/` | Espelho incremental em `backups/files/deliverables` (imutáveis por versão) |
| Anexos enviados | `data/uploads/` | Espelho incremental |
| Workspaces das conversas | `data/workspaces/` | Espelho incremental do estado mais recente (sem `node_modules`, `.git`, `.tmp`) |

O espelho de arquivos é **aditivo**: o backup nunca apaga arquivos espelhados. Os snapshots do banco seguem a retenção abaixo.

## Backup automático

- Ao iniciar e a cada 5 min o monitor verifica se o último snapshot é mais antigo que `MD2_BACKUP_INTERVAL_HOURS` (padrão 6 h); se for, cria um novo.
- Cada snapshot é **verificado logo após a criação** (hash + integridade + presença dos arquivos de todas as versões de entregáveis). Um snapshot que não passa fica marcado "NÃO verificado" e gera registro crítico no log e na auditoria.
- **Retenção** (`MD2_BACKUP_KEEP`, padrão 14, mínimo 2): mantém os mais recentes; nunca apaga quando há 1 ou menos; nunca apaga o snapshot verificado mais recente; só remove diretórios com manifesto deste sistema.
- Local: `MD2_BACKUP_DIR` (padrão `./backups`, fora de `data/`). **Recomendado: outro disco ou pasta sincronizada externamente** — um backup no mesmo disco não protege contra falha de disco.

## Comandos

```bash
npm run backup
```

```bash
npm run backup -- list
```

```bash
npm run backup -- verify all
```

Também na interface: Configurações → Backups ("Fazer backup agora" e "Verificar").

## Restauração

A restauração **nunca sobrescreve** dados: o destino precisa ser um diretório novo ou vazio, e não pode ser o `MD2_DATA_DIR` em uso.

1. Liste e verifique os snapshots:

```bash
npm run backup -- verify all
```

2. Restaure o escolhido em um diretório novo:

```bash
npm run backup -- restore 20261115-031039 ./data-restaurado
```

3. Pare o servidor atual e inicie apontando para os dados restaurados:

```bash
MD2_DATA_DIR=./data-restaurado npm start
```

4. Confira a interface (Histórico, Entregáveis). Só depois, se quiser, troque o `MD2_DATA_DIR` no `.env`. O diretório antigo permanece intacto.

Observação: o espelho de workspaces guarda o estado mais recente, não o do momento do snapshot. Entregáveis são exatos por versão.

### Procedimento testado em 15/11/2026 (dados reais da execução do site)

| Passo | Resultado |
|---|---|
| Backup 1 | Verificado; 71 arquivos espelhados; contagens: 6 tarefas, 6 entregáveis, 7 versões |
| Backup 2 (sem mudanças) | Verificado; **0 arquivos copiados** (incremental) — após correção de um defeito de precisão de data que recopiava tudo |
| Corrupção proposital de 1 byte no banco do snapshot | `verify` acusou "hash do banco não confere"; o outro snapshot seguiu OK |
| Restauração em diretório novo | 71 arquivos; servidor subiu com os dados restaurados; 6 entregáveis listados; site restaurado servido (HTTP 200, conteúdo correto) |
| Restaurar sobre diretório não vazio | Recusado |
| Restaurar sobre o `MD2_DATA_DIR` em uso | Recusado |

## Recuperação de execuções

- O estado de tudo vive no SQLite; o navegador é só janela. Fechar a interface não interrompe nada.
- Ao iniciar, `Engine.recover()` identifica execuções não terminadas:
  - tarefas que estavam executando voltam para a fila e **retomam a sessão salva do agente** (o histórico do trabalho é preservado); a interrupção é registrada em `tasks.interruptions` e nos eventos;
  - tarefa que já esgotou `MD2_TASK_MAX_ATTEMPTS` é marcada como falha;
  - execução retomada mais de `MD2_MAX_RECOVERIES` vezes (padrão 2) é encerrada como falha com mensagem explícita — **sem ciclo infinito**;
  - execuções aguardando aprovação não são tocadas.
- Retentativa e sessão retomada não contam custo em dobro.
- Falhas de tarefa e de recuperação são relatadas ao Alfred na validação, aparecem na devolutiva e nos eventos.

Testado de verdade: servidor derrubado com `SIGKILL` no meio de duas tarefas paralelas, reiniciado, execução retomada e concluída (ver `docs/RELATORIO_OPERACAO_NOTURNA.md`).

## Monitoramento

- `GET /api/health` (público, mínimo): `{ ok, status }` — HTTP 200 quando saudável ou em atenção, 503 quando crítico. Use em monitor externo (Uptime Kuma, cron + curl).
- `GET /api/health/details` (com login): banco (`quick_check`), espaço livre (alerta abaixo de 2 GB), tarefas travadas (> 1,5× o tempo limite), runtime, isolamento, idade e verificação do último backup, fila, memória.
- O monitor registra mudanças de estado no log; estado **crítico** (banco ou disco) e falhas de backup vão também para a auditoria (`falha_critica`).
- Exceção não tratada: registrada como crítica e o processo encerra para o supervisor reiniciar; a recuperação retoma o trabalho.

## Logs

- JSON por linha no stdout e em `data/logs/md2-AAAA-MM-DD.jsonl` (`MD2_LOG_DIR`), retenção de 30 dias.
- Segredos são mascarados antes de gravar (chaves, tokens, senhas, cookies).

## Operação 24 h

Rode `npm start` sob um supervisor que reinicie em caso de queda (systemd `Restart=always`, pm2 ou Docker `restart: always`) e monitore `/api/health` externamente. Exemplo de unidade systemd em `docs/SEGURANCA.md`.
