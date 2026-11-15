import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.js';
import { isPrivateUrl } from './runtime/guard.js';
import { detectSandbox, inPath } from './runtime/sandbox.js';

/**
 * Preflight dos cenários de validação real. Não chama o modelo: usa só ffprobe/FFmpeg, o sistema de arquivos e HTTP
 * simples. Serve para dizer, ANTES de gastar, se o material e o ambiente permitem uma validação honesta.
 */

const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.3gp']);
const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac']);
/** Abaixo disto, a imagem é lisa demais para ser filmagem natural. Calibrado só com amostras sintéticas (ver docs). */
export const LOW_COMPLEXITY = 1.5;
export const MIN_VIDEOS = 3;
export const MIN_TOTAL_SECONDS = 60;

export interface MediaFile {
  path: string; name: string; kind: 'video' | 'foto' | 'audio' | 'texto' | 'outro'; bytes: number;
  readable?: boolean; error?: string;
  duration?: number; width?: number; height?: number; fps?: number; codec?: string; hasAudio?: boolean; rotation?: number;
  tags?: Record<string, string>; complexity?: number;
}
export interface MediaReport {
  dir: string; files: MediaFile[]; videos: MediaFile[]; photos: MediaFile[];
  totalVideoSeconds: number; totalBytes: number; readmes: Array<{ name: string; excerpt: string }>;
}
export type Verdict = 'PRONTO' | 'PRONTO_COM_RESSALVAS' | 'BLOQUEADO';
export interface Evaluation {
  verdict: Verdict; blockers: string[]; warnings: string[];
  /** Indícios objetivos de material sintético ou de teste. Não provam nada sozinhos; impedem "validado" sem ressalva. */
  syntheticFlags: string[];
  cameraEvidence: number;
}

export type Runner = (cmd: string, args: string[]) => { status: number | null; stdout: Buffer; stderr: string };
const run: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: String(r.stderr ?? '') };
};

const kindOf = (name: string): MediaFile['kind'] => {
  const e = path.extname(name).toLowerCase();
  return VIDEO_EXT.has(e) ? 'video' : PHOTO_EXT.has(e) ? 'foto' : AUDIO_EXT.has(e) ? 'audio' : ['.txt', '.md', '.csv'].includes(e) ? 'texto' : 'outro';
};

/** Complexidade visual: média da diferença absoluta entre pixels vizinhos em 2 quadros (25% e 75%), em tons de cinza 160x90. */
export function complexityOf(file: string, duration: number, exec: Runner = run): number | undefined {
  const scores: number[] = [];
  for (const frac of [0.25, 0.75]) {
    const r = exec('ffmpeg', ['-v', 'error', '-ss', String(Math.max(0, duration * frac)), '-i', file, '-frames:v', '1', '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', '-']);
    if (r.status !== 0 || r.stdout.length < 160 * 90) continue;
    const px = r.stdout;
    let sum = 0, n = 0;
    for (let y = 0; y < 90; y++) for (let x = 1; x < 160; x++) { sum += Math.abs(px[y * 160 + x] - px[y * 160 + x - 1]); n++; }
    scores.push(sum / n);
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
}

export function probe(file: string, exec: Runner = run): Partial<MediaFile> {
  const r = exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.status !== 0) return { readable: false, error: (r.stderr || 'ffprobe falhou').trim().split('\n')[0].slice(0, 200) };
  try {
    const j = JSON.parse(r.stdout.toString('utf8')) as { format?: { duration?: string; tags?: Record<string, string> }; streams?: Array<Record<string, any>> };
    const v = j.streams?.find((s) => s.codec_type === 'video');
    const a = j.streams?.find((s) => s.codec_type === 'audio');
    const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const tags: Record<string, string> = {};
    for (const src of [j.format?.tags, v?.tags]) for (const [k, val] of Object.entries(src ?? {})) tags[k.toLowerCase()] = String(val);
    const rot = Number(v?.side_data_list?.find((d: Record<string, unknown>) => 'rotation' in d)?.rotation ?? v?.tags?.rotate ?? 0);
    return {
      readable: true, duration: Number(j.format?.duration ?? v?.duration ?? 0), width: v?.width, height: v?.height,
      fps: den ? Number((num / den).toFixed(2)) : undefined, codec: v?.codec_name, hasAudio: !!a, rotation: rot || 0, tags,
    };
  } catch {
    return { readable: false, error: 'saída do ffprobe ilegível' };
  }
}

export function inspectMediaFolder(dir: string, exec: Runner = run, withComplexity = true): MediaReport {
  const files: MediaFile[] = [];
  const walk = (d: string, depth: number) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (!e.isFile()) continue;
      files.push({ path: p, name: path.relative(dir, p), kind: kindOf(e.name), bytes: fs.statSync(p).size });
    }
  };
  walk(dir, 0);
  for (const f of files.filter((x) => x.kind === 'video')) {
    Object.assign(f, probe(f.path, exec));
    if (withComplexity && f.readable && f.duration) f.complexity = complexityOf(f.path, f.duration, exec);
  }
  const readmes = files.filter((f) => f.kind === 'texto' && f.bytes < 20_000).map((f) => ({ name: f.name, excerpt: fs.readFileSync(f.path, 'utf8').slice(0, 300) }));
  const videos = files.filter((f) => f.kind === 'video');
  return {
    dir, files, videos, photos: files.filter((f) => f.kind === 'foto'),
    totalVideoSeconds: videos.reduce((s, v) => s + (v.duration ?? 0), 0), totalBytes: files.reduce((s, f) => s + f.bytes, 0), readmes,
  };
}

const CAMERA_TAGS = ['make', 'model', 'com.apple.quicktime.make', 'com.apple.quicktime.model', 'com.android.version', 'com.apple.quicktime.creationdate'];
const TESTY = /\b(teste|test|sint[eé]tic|fake|demo|exemplo|placeholder|lorem)\b/i;

export function evaluateMaterial(r: MediaReport, opts: { authorized: boolean; targetSeconds?: number }): Evaluation {
  const blockers: string[] = [], warnings: string[] = [], flags: string[] = [];
  if (!opts.authorized) blockers.push('A pasta não está dentro de MD2_AUTHORIZED_DIRS. Adicione a pasta (ou a pasta-mãe) a essa variável e reinicie o servidor.');
  const readable = r.videos.filter((v) => v.readable);
  const unreadable = r.videos.filter((v) => v.readable === false);
  for (const u of unreadable) warnings.push(`Vídeo ilegível: ${u.name} (${u.error})`);
  if (readable.length < MIN_VIDEOS) blockers.push(`Só há ${readable.length} vídeo(s) legível(is); a validação exige pelo menos ${MIN_VIDEOS}.`);
  const target = opts.targetSeconds ?? 30;
  const need = Math.max(MIN_TOTAL_SECONDS, target * 2);
  if (r.totalVideoSeconds < need) blockers.push(`Total de ${r.totalVideoSeconds.toFixed(0)} s de vídeo; para escolher os melhores trechos de um Reels de ${target} s são necessários pelo menos ${need} s.`);
  if (!readable.some((v) => v.hasAudio)) warnings.push('Nenhum vídeo tem áudio: o Reels sairá sem som ambiente.');
  const low = readable.filter((v) => (v.width ?? 0) < 720 && (v.height ?? 0) < 720);
  if (low.length) warnings.push(`${low.length} vídeo(s) abaixo de 720 px: baixa qualidade em tela vertical (${low.map((v) => v.name).join(', ')}).`);
  if (r.totalBytes > 8 * 1024 ** 3) warnings.push(`Pasta com ${(r.totalBytes / 1024 ** 3).toFixed(1)} GB: a análise será demorada.`);

  const withCamera = readable.filter((v) => CAMERA_TAGS.some((k) => v.tags?.[k]));
  const withDate = readable.filter((v) => v.tags?.creation_time);
  const lavf = readable.filter((v) => /lavf|lavc|ffmpeg/i.test(`${v.tags?.encoder ?? ''} ${v.tags?.software ?? ''}`) && !CAMERA_TAGS.some((k) => v.tags?.[k]));
  if (readable.length && withCamera.length === 0) flags.push(`Nenhum vídeo traz metadados de câmera ou celular (marca/modelo).`);
  if (readable.length && withDate.length === 0) flags.push('Nenhum vídeo traz data de criação.');
  if (lavf.length === readable.length && readable.length) flags.push('Todos os vídeos foram gerados pelo FFmpeg (tag de encoder), sem origem de câmera.');
  const lisos = readable.filter((v) => v.complexity !== undefined && v.complexity < LOW_COMPLEXITY);
  if (lisos.length) flags.push(`${lisos.length} de ${readable.length} vídeo(s) têm imagem lisa demais para filmagem natural (complexidade < ${LOW_COMPLEXITY}): ${lisos.map((v) => `${v.name} (${v.complexity!.toFixed(2)})`).join(', ')}.`);
  const testy = [...r.files.filter((f) => TESTY.test(f.name)).map((f) => `nome "${f.name}"`), ...r.readmes.filter((m) => TESTY.test(m.excerpt)).map((m) => `texto em ${m.name}`)];
  if (testy.length) flags.push(`Indícios de material de teste: ${testy.join('; ')}.`);

  // Metadados ausentes sozinhos são comuns em vídeos exportados por editores; só viram "suspeita" combinados com imagem lisa ou texto de teste.
  const suspeito = lisos.length > 0 || testy.length > 0;
  if (suspeito) warnings.push('O material parece sintético ou de teste: o resultado NÃO pode ser declarado como validação com material real.');
  const verdict: Verdict = blockers.length ? 'BLOQUEADO' : warnings.length || flags.length ? 'PRONTO_COM_RESSALVAS' : 'PRONTO';
  return { verdict, blockers, warnings, syntheticFlags: flags, cameraEvidence: withCamera.length };
}

export interface EnvReport { items: Array<{ ok: boolean; label: string; detail: string }>; blockers: string[]; warnings: string[] }
export function checkEnvironment(config: Config, probeBin: (b: string) => boolean = inPath, platform = process.platform): EnvReport {
  const items: EnvReport['items'] = [];
  const blockers: string[] = [], warnings: string[] = [];
  const add = (ok: boolean, label: string, detail: string, kind: 'b' | 'w' = 'b') => { items.push({ ok, label, detail }); if (!ok) (kind === 'b' ? blockers : warnings).push(`${label}: ${detail}`); };
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 22, 'Node.js', `v${process.versions.node} (necessário 22.13 ou superior)`);
  add(probeBin('ffmpeg') && probeBin('ffprobe'), 'FFmpeg e ffprobe', probeBin('ffmpeg') && probeBin('ffprobe') ? 'encontrados no PATH' : 'não encontrados no PATH');
  const sb = detectSandbox(config, probeBin, platform);
  add(sb.active, 'Isolamento dos agentes (sandbox de SO)', sb.detail, config.agentSandbox === 'required' ? 'b' : 'w');
  add(config.agentSandbox !== 'off', 'MD2_AGENT_SANDBOX', `modo "${config.agentSandbox}"${config.agentSandbox === 'off' ? ': desativado, não recomendado' : ''}`, 'w');
  add(!!(process.env.ANTHROPIC_API_KEY || fs.existsSync(path.join(process.env.HOME ?? '', '.claude'))), 'Credencial do Claude', process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY definida' : 'sem ANTHROPIC_API_KEY; usará o login do Claude Code, se existir (não verificado aqui para não gastar)', 'w');
  try {
    const st = fs.statfsSync(fs.existsSync(config.dataDir) ? config.dataDir : path.dirname(config.dataDir));
    const gb = (st.bavail * st.bsize) / 1024 ** 3;
    add(gb > 2, 'Espaço em disco', `${gb.toFixed(1)} GB livres onde ficam os dados`);
  } catch { add(false, 'Espaço em disco', 'não foi possível medir', 'w'); }
  const fonts = spawnSync('fc-list', [], { encoding: 'utf8', timeout: 5000 });
  add(fonts.status === 0 && /bold|negrito/i.test(fonts.stdout), 'Fonte em negrito para textos do vídeo', fonts.status === 0 ? (/bold|negrito/i.test(fonts.stdout) ? 'encontrada' : 'nenhuma fonte em negrito') : 'fc-list indisponível', 'w');
  return { items, blockers, warnings };
}

export interface UrlCheck { url: string; ok: boolean; status?: number; note: string }
const HOSTS = { maps: /(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$|^g\.co$/i, instagram: /(^|\.)instagram\.com$/i };
/** Valida o formato e testa o acesso público. Instagram quase sempre exige login: o teste avisa antes de gastar. */
export async function checkUrl(kind: 'maps' | 'instagram' | 'site', raw: string, fetchImpl: typeof fetch = fetch): Promise<UrlCheck> {
  let u: URL;
  try { u = new URL(raw); } catch { return { url: raw, ok: false, note: 'URL inválida.' }; }
  if (!/^https?:$/.test(u.protocol)) return { url: raw, ok: false, note: 'Use um endereço http ou https.' };
  if (isPrivateUrl(raw)) return { url: raw, ok: false, note: 'Endereço interno não é permitido.' };
  if (kind !== 'site' && !HOSTS[kind].test(u.hostname)) return { url: raw, ok: false, note: `O endereço não parece ser do ${kind === 'maps' ? 'Google Maps' : 'Instagram'}.` };
  try {
    const res = await fetchImpl(raw, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; MD2-preflight)' } });
    const final = res.url;
    if (kind === 'instagram' && (/accounts\/login/.test(final) || res.status === 429 || res.status === 403)) return { url: raw, ok: false, status: res.status, note: 'O Instagram exige login para esta página. Envie capturas de tela do perfil (bio, grade de posts, destaques) como anexo; o sistema não faz login.' };
    if (res.status >= 400) return { url: raw, ok: false, status: res.status, note: `Resposta HTTP ${res.status}.` };
    return { url: raw, ok: true, status: res.status, note: kind === 'maps' ? 'Acessível. Parte do conteúdo do Maps é carregada por JavaScript e pode não aparecer na leitura simples: capturas das avaliações ajudam.' : 'Acessível.' };
  } catch (e) {
    return { url: raw, ok: false, note: `Sem acesso a partir desta máquina: ${(e as Error).message}` };
  }
}

/** Confere se um arquivo parece uma imagem pelo cabeçalho (não pela extensão). */
export function sniffImage(file: string): 'png' | 'jpg' | 'webp' | 'gif' | 'svg' | null {
  try {
    const b = Buffer.alloc(16);
    const fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd);
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
    if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
    if (b.subarray(0, 3).toString() === 'GIF') return 'gif';
    if (fs.readFileSync(file, 'utf8').slice(0, 300).includes('<svg')) return 'svg';
  } catch { /* ilegível */ }
  return null;
}

/** A pasta está dentro de alguma pasta autorizada (caminho real, links simbólicos resolvidos)? */
export function isAuthorized(dir: string, authorized: string[]): boolean {
  let real: string;
  try { real = fs.realpathSync.native(dir); } catch { return false; }
  return authorized.some((a) => { try { const ra = fs.realpathSync.native(a); const rel = path.relative(ra, real); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); } catch { return false; } });
}
