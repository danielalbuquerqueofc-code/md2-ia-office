/**
 * Backup e restauração por linha de comando.
 *   npm run backup                       cria um snapshot verificado agora
 *   npm run backup -- list               lista snapshots
 *   npm run backup -- verify [nome|all]  verifica integridade (padrão: o mais recente)
 *   npm run backup -- restore <nome> <novo-diretorio-de-dados>
 * A restauração nunca sobrescreve: o destino precisa estar vazio ou não existir.
 */
import path from 'node:path';
import { BackupService, restoreSnapshot } from '../src/backup.js';
import { loadConfig } from '../src/config.js';
import { Db } from '../src/db.js';

const [cmd = 'create', a, b] = process.argv.slice(2);
const config = loadConfig();

if (cmd === 'restore') {
  if (!a || !b) throw new Error('Uso: npm run backup -- restore <nome-do-snapshot> <novo-diretorio-de-dados>');
  const snapDir = path.isAbsolute(a) ? a : path.join(config.backupDir, 'snapshots', a);
  const target = path.resolve(b);
  if (target === config.dataDir) throw new Error('O destino não pode ser o diretório de dados em uso. Restaure em um diretório novo.');
  const r = restoreSnapshot(snapDir, target);
  console.log(`Restaurado em ${target} (${r.files} arquivos). Para usar: MD2_DATA_DIR=${target} npm start`);
  process.exit(0);
}

const db = new Db(path.join(config.dataDir, 'md2.sqlite'));
const svc = new BackupService(db, config.dataDir, config.backupDir, config.backupKeep);
try {
  if (cmd === 'create') {
    const s = await svc.create();
    console.log(`Snapshot ${s.name} criado e verificado em ${s.dir}`);
    console.log(`  banco: ${s.manifest.db.bytes} bytes, sha256 ${s.manifest.db.sha256.slice(0, 16)}…, integridade ${s.manifest.db.integrity}`);
    console.log(`  arquivos: ${s.manifest.files.mirrored} espelhados, ${s.manifest.files.copied} copiados agora`);
    console.log(`  contagens: ${JSON.stringify(s.manifest.counts)}`);
  } else if (cmd === 'list') {
    for (const s of svc.list()) console.log(`${s.name}  ${s.manifest.verified ? 'verificado' : 'NÃO verificado'}  ${s.manifest.db.bytes} bytes  execuções=${s.manifest.counts.executions}`);
  } else if (cmd === 'verify') {
    const all = svc.list();
    const targets = a === 'all' ? all : [a ? all.find((s) => s.name === a) : all[0]].filter((x): x is NonNullable<typeof x> => !!x);
    if (!targets.length) throw new Error('Nenhum snapshot encontrado.');
    let bad = 0;
    for (const s of targets) {
      const v = svc.verify(s);
      if (!v.ok) bad++;
      console.log(`${s.name}: ${v.ok ? 'OK' : 'FALHOU'}  hash=${v.checked.dbHash ? 'ok' : 'divergente'} integridade=${v.checked.integrity} arquivos de entregáveis=${v.checked.deliverableFiles}`);
      for (const p of v.problems) console.log(`   - ${p}`);
    }
    process.exitCode = bad ? 1 : 0;
  } else {
    throw new Error(`Comando desconhecido: ${cmd}`);
  }
} finally {
  db.close();
}
