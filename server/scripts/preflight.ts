/**
 * Preflight dos cenários de validação real (sem chamar o modelo, sem gastar).
 *   npm run preflight -- --cenario b --pasta "C:\Clientes\Pão de Mel" [--duracao 30]
 *   npm run preflight -- --cenario a --maps URL --instagram URL [--site URL] [--logo arquivo] [--fotos pasta]
 * Sai com código 1 se houver bloqueio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { checkEnvironment, checkUrl, evaluateMaterial, inspectMediaFolder, isAuthorized, sniffImage } from '../src/preflight.js';

const args = new Map<string, string>();
const raw = process.argv.slice(2);
for (let i = 0; i < raw.length; i++) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(raw[i]);
  if (m) args.set(m[1], m[2] ?? (raw[i + 1] && !raw[i + 1].startsWith('--') ? raw[++i] : 'true'));
}
const cenario = (args.get('cenario') ?? '').toLowerCase();
if (!['a', 'b'].includes(cenario)) { console.error('Informe --cenario a (site) ou --cenario b (Reels).'); process.exit(2); }

const config = loadConfig();
const blockers: string[] = [], warnings: string[] = [];
const summary: { cenario: string; syntheticFlags: string[]; suspectedSynthetic: boolean; cameraEvidence: number; videos: number; totalVideoSeconds: number } = { cenario, syntheticFlags: [], suspectedSynthetic: false, cameraEvidence: 0, videos: 0, totalVideoSeconds: 0 };
const line = (ok: boolean | null, text: string) => console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${text}`);

console.log(`\n== Preflight do cenário ${cenario.toUpperCase()} (${cenario === 'a' ? 'criação de site' : 'Reels a partir de pasta com vídeos'}) ==\n`);
console.log('Ambiente');
const env = checkEnvironment(config);
for (const i of env.items) line(i.ok, `${i.label}: ${i.detail}`);
blockers.push(...env.blockers);
warnings.push(...env.warnings);
console.log(`· Teto de custo: tarefa US$ ${config.maxCostPerTask}, execução US$ ${config.maxCostPerExecution}, dia US$ ${config.maxCostPerDay} (a validação não altera esses valores)`);

if (cenario === 'b') {
  const pasta = args.get('pasta');
  console.log('\nMaterial');
  if (!pasta) { blockers.push('Informe --pasta com o caminho da pasta de vídeos.'); line(false, 'Pasta não informada'); }
  else if (!fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) { blockers.push(`A pasta não existe: ${pasta}`); line(false, `Pasta inexistente: ${pasta}`); }
  else {
    const dir = path.resolve(pasta);
    const target = Number(args.get('duracao') ?? 30);
    const rep = inspectMediaFolder(dir);
    const ev = evaluateMaterial(rep, { authorized: isAuthorized(dir, config.authorizedDirs), targetSeconds: target });
    line(isAuthorized(dir, config.authorizedDirs), `Pasta autorizada em MD2_AUTHORIZED_DIRS: ${dir}`);
    console.log(`· ${rep.files.length} arquivos: ${rep.videos.length} vídeo(s), ${rep.photos.length} foto(s); ${rep.totalVideoSeconds.toFixed(0)} s de vídeo no total; ${(rep.totalBytes / 1024 ** 2).toFixed(0)} MB`);
    console.log('\n  Arquivo                                  Duração  Resolução   fps   Áudio  Câmera  Complex.');
    for (const v of rep.videos) {
      const cam = v.tags && ['make', 'model', 'com.apple.quicktime.make'].some((k) => v.tags![k]) ? (v.tags['make'] ?? v.tags['com.apple.quicktime.make'] ?? 'sim') : '—';
      console.log(`  ${v.name.slice(0, 40).padEnd(40)} ${v.readable ? `${(v.duration ?? 0).toFixed(1).padStart(6)}s  ${`${v.width}x${v.height}`.padEnd(10)} ${String(v.fps ?? '').padEnd(5)} ${(v.hasAudio ? 'sim' : 'não').padEnd(6)} ${cam.slice(0, 7).padEnd(7)} ${v.complexity !== undefined ? v.complexity.toFixed(2) : '—'}` : `ILEGÍVEL: ${v.error}`}`);
    }
    if (rep.readmes.length) console.log(`\n· Textos na pasta: ${rep.readmes.map((m) => `${m.name} ("${m.excerpt.replace(/\s+/g, ' ').slice(0, 80)}…")`).join('; ')}`);
    blockers.push(...ev.blockers);
    warnings.push(...ev.warnings);
    if (ev.syntheticFlags.length) { console.log('\nIndícios sobre a natureza do material (fatos medidos, não conclusão):'); for (const f of ev.syntheticFlags) console.log(`  - ${f}`); }
    const sintetico = ev.warnings.some((w) => /sintético ou de teste/.test(w));
    Object.assign(summary, { syntheticFlags: ev.syntheticFlags, suspectedSynthetic: sintetico, cameraEvidence: ev.cameraEvidence, videos: rep.videos.length, totalVideoSeconds: Number(rep.totalVideoSeconds.toFixed(1)) });
    console.log(`\nValidação com material real: ${sintetico ? 'NÃO — o material parece sintético ou de teste' : 'possível, desde que você confirme que o material é real (--material-real)'}`);
  }
} else {
  console.log('\nInsumos do cliente');
  const pending: Array<{ key: 'maps' | 'instagram' | 'site'; p: ReturnType<typeof checkUrl> }> = [];
  const offline = args.get('sem-rede') === 'true';
  for (const key of ['maps', 'instagram', 'site'] as const) {
    const v = args.get(key);
    if (v && !offline) pending.push({ key, p: checkUrl(key, v) });
    else if (v) console.log(`· ${key}: ${v} (acesso não testado, --sem-rede)`);
    else if (key !== 'site') { warnings.push(`Sem link do ${key === 'maps' ? 'Google Maps' : 'Instagram'}: a pesquisa dessa fonte não será feita.`); line(false, `${key}: não informado`); }
  }
  for (const { key, p } of pending) {
    const r = await p;
    line(r.ok, `${key}: ${r.url} — ${r.note}`);
    if (!r.ok) warnings.push(key === 'instagram' ? 'Instagram sem leitura pública: envie capturas de tela do perfil.' : `${key}: ${r.note}`);
  }
  const logo = args.get('logo');
  if (logo) { const k = fs.existsSync(logo) ? sniffImage(logo) : null; line(!!k, `logo: ${logo} ${k ? `(${k}, ${fs.statSync(logo).size} bytes)` : '— arquivo ausente ou não é imagem'}`); if (!k) warnings.push('Logo ausente ou inválido: a identidade visual será proposta sem ela.'); }
  else { line(false, 'logo: não informada'); warnings.push('Sem logo: a identidade visual será proposta do zero.'); }
  const fotos = args.get('fotos');
  if (fotos && fs.existsSync(fotos)) { const n = fs.readdirSync(fotos).filter((f) => sniffImage(path.join(fotos, f))).length; line(n > 0, `fotos: ${n} imagem(ns) em ${fotos}`); if (!n) warnings.push('Pasta de fotos sem imagens válidas.'); }
  else { line(false, 'fotos: não informadas'); warnings.push('Sem fotos do cliente: o site usará composições próprias, sem imagens reais.'); }
}

console.log('\nResultado');
for (const b of blockers) line(false, `BLOQUEIO: ${b}`);
for (const w of warnings) line(null, `ressalva: ${w}`);
const verdict = blockers.length ? 'BLOQUEADO' : warnings.length ? 'PRONTO COM RESSALVAS' : 'PRONTO';
console.log(`\n=> ${verdict}`);
if (!blockers.length) {
  const base = cenario === 'b'
    ? `node e2e/real-operation.mjs --cenario=b --pasta="${args.get('pasta')}" --tema="<tema do vídeo>" --material-real`
    : `node e2e/real-operation.mjs --cenario=a --maps="${args.get('maps') ?? '<link>'}" --instagram="${args.get('instagram') ?? '<link>'}"${args.get('logo') ? ` --anexos="${args.get('logo')}"` : ''}`;
  console.log(`Próximo passo (consome créditos; o limite é o teto configurado):\n  ${base}`);
}
const out = args.get('saida');
if (out) fs.writeFileSync(out, JSON.stringify({ ...summary, verdict, blockers, warnings }, null, 2));
process.exit(blockers.length ? 1 : 0);
