import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { checkEnvironment, checkUrl, evaluateMaterial, inspectMediaFolder, isAuthorized, sniffImage } from '../src/preflight.js';
import { ROOT } from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-pre-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const config = loadConfig({}, ROOT);

/**
 * ATENÇÃO: estes vídeos são sintéticos e existem SÓ para testar o detector. Nenhum teste aqui valida o cenário B:
 * a validação com material real exige a pasta real do usuário (docs/PLANO_VALIDACAO_REAL.md).
 */
function makeVideo(file: string, kind: 'liso' | 'ruido', opts: { camera?: boolean; seconds?: number } = {}) {
  const src = kind === 'liso' ? 'gradients=s=320x180:r=5:c0=0x6b3e1f:c1=0xd9a066:speed=0.02' : 'nullsrc=s=320x180:r=5,geq=random(1)*255:128:128';
  // use_metadata_tags faz o FFmpeg gravar make/model como uma câmera real faria.
  const meta = opts.camera ? ['-movflags', 'use_metadata_tags', '-metadata', 'make=Apple', '-metadata', 'model=iPhone 15', '-metadata', 'creation_time=2026-10-01T12:00:00Z'] : [];
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', String(opts.seconds ?? 16),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...meta, file]);
  if (r.status !== 0) throw new Error(String(r.stderr));
}
const folder = (name: string, files: Array<[string, 'liso' | 'ruido', { camera?: boolean; seconds?: number }?]>, extra: Record<string, string> = {}) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, k, o] of files) makeVideo(path.join(dir, f), k, o);
  for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
};

describe.skipIf(!hasFfmpeg)('detector de material (amostras sintéticas, só para testar o detector)', () => {
  it('acusa material liso, sem origem de câmera e com texto de teste, e avisa que não vale como validação real', () => {
    const dir = folder('liso', [['a.mp4', 'liso'], ['b.mp4', 'liso'], ['c.mp4', 'liso'], ['d.mp4', 'liso']], { 'LEIAME_TESTE.txt': 'Material de TESTE gerado sinteticamente.' });
    const ev = evaluateMaterial(inspectMediaFolder(dir), { authorized: true });
    expect(ev.cameraEvidence).toBe(0);
    expect(ev.syntheticFlags.join('\n')).toMatch(/metadados de câmera/);
    expect(ev.syntheticFlags.join('\n')).toMatch(/gerados pelo FFmpeg/);
    expect(ev.syntheticFlags.join('\n')).toMatch(/lisa demais/);
    expect(ev.syntheticFlags.join('\n')).toMatch(/material de teste.*LEIAME_TESTE/);
    expect(ev.warnings.join('\n')).toMatch(/NÃO pode ser declarado como validação com material real/);
    expect(ev.verdict).toBe('PRONTO_COM_RESSALVAS');
  });

  it('não acusa material com metadados de câmera e imagem complexa (prova a mecânica; não prova que é real)', () => {
    const dir = folder('camera', [['IMG_1.mp4', 'ruido', { camera: true }], ['IMG_2.mp4', 'ruido', { camera: true }], ['IMG_3.mp4', 'ruido', { camera: true }], ['IMG_4.mp4', 'ruido', { camera: true }]]);
    const rep = inspectMediaFolder(dir);
    expect(rep.videos.every((v) => (v.complexity ?? 0) > 5)).toBe(true);
    const ev = evaluateMaterial(rep, { authorized: true });
    expect(ev.cameraEvidence).toBe(4);
    expect(ev.syntheticFlags).toEqual([]);
    expect(ev.warnings.filter((w) => /sintético/.test(w))).toEqual([]);
    // As amostras têm 320x180 px: o único aviso esperado é o de resolução baixa, e ele é correto.
    expect(ev.warnings).toHaveLength(1);
    expect(ev.warnings[0]).toMatch(/abaixo de 720 px/);
    expect(ev.blockers).toEqual([]);
    expect(ev.verdict).toBe('PRONTO_COM_RESSALVAS');
  });

  it('bloqueia pasta fora das autorizadas, com poucos vídeos ou com pouco material', () => {
    const dir = folder('poucos', [['a.mp4', 'ruido', { camera: true, seconds: 5 }], ['b.mp4', 'ruido', { camera: true, seconds: 5 }]]);
    const ev = evaluateMaterial(inspectMediaFolder(dir), { authorized: false });
    expect(ev.verdict).toBe('BLOQUEADO');
    expect(ev.blockers.join('\n')).toMatch(/MD2_AUTHORIZED_DIRS/);
    expect(ev.blockers.join('\n')).toMatch(/Só há 2 vídeo/);
    expect(ev.blockers.join('\n')).toMatch(/são necessários pelo menos 60 s/);
  });

  it('lista vídeo ilegível sem derrubar o restante', () => {
    const dir = folder('quebrado', [['a.mp4', 'ruido', { camera: true }], ['b.mp4', 'ruido', { camera: true }], ['c.mp4', 'ruido', { camera: true }]], {});
    fs.writeFileSync(path.join(dir, 'corrompido.mp4'), 'isto não é um vídeo');
    const rep = inspectMediaFolder(dir);
    expect(rep.videos).toHaveLength(4);
    expect(rep.videos.find((v) => v.name === 'corrompido.mp4')!.readable).toBe(false);
    expect(evaluateMaterial(rep, { authorized: true }).warnings.join('\n')).toMatch(/Vídeo ilegível: corrompido\.mp4/);
  });
});

describe('autorização de pasta por caminho real', () => {
  it('aceita subpasta e recusa link simbólico que escapa da pasta autorizada', () => {
    const auth = path.join(tmp, 'auth');
    const outside = path.join(tmp, 'fora');
    fs.mkdirSync(path.join(auth, 'cliente'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(auth, 'atalho'));
    expect(isAuthorized(path.join(auth, 'cliente'), [auth])).toBe(true);
    expect(isAuthorized(auth, [auth])).toBe(true);
    expect(isAuthorized(path.join(auth, 'atalho'), [auth])).toBe(false);
    expect(isAuthorized(outside, [auth])).toBe(false);
    expect(isAuthorized(path.join(tmp, 'inexistente'), [auth])).toBe(false);
  });
});

describe('links do cenário A', () => {
  const resp = (status: number, url: string) => ({ status, url }) as Response;
  it('Instagram que redireciona para login avisa para enviar capturas de tela, antes de gastar', async () => {
    const r = await checkUrl('instagram', 'https://www.instagram.com/padaria/', async () => resp(200, 'https://www.instagram.com/accounts/login/?next=/padaria/'));
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/exige login.*capturas de tela/);
  });
  it('valida formato, host esperado e endereços internos', async () => {
    const never = (async () => { throw new Error('não deveria buscar'); }) as unknown as typeof fetch;
    expect((await checkUrl('maps', 'não é url', never)).note).toMatch(/inválida/);
    expect((await checkUrl('maps', 'ftp://x.com', never)).note).toMatch(/http/);
    expect((await checkUrl('maps', 'http://127.0.0.1/admin', never)).note).toMatch(/interno/);
    expect((await checkUrl('maps', 'https://exemplo.com/maps', never)).note).toMatch(/não parece ser do Google Maps/);
    expect((await checkUrl('instagram', 'https://facebook.com/x', never)).note).toMatch(/Instagram/);
  });
  it('Maps acessível é aceito com a ressalva sobre conteúdo carregado por JavaScript; erro de rede é explicado', async () => {
    const ok = await checkUrl('maps', 'https://maps.app.goo.gl/abc', async () => resp(200, 'https://www.google.com/maps/place/x'));
    expect(ok.ok).toBe(true);
    expect(ok.note).toMatch(/JavaScript/);
    const off = await checkUrl('site', 'https://exemplo.com', (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch);
    expect(off.ok).toBe(false);
    expect(off.note).toMatch(/ENOTFOUND/);
  });
  it('reconhece imagem pelo cabeçalho, não pela extensão', () => {
    const png = path.join(tmp, 'logo.png.txt');
    fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
    expect(sniffImage(png)).toBe('png');
    const fake = path.join(tmp, 'logo.png');
    fs.writeFileSync(fake, 'isto é texto');
    expect(sniffImage(fake)).toBeNull();
  });
});

describe('ambiente', () => {
  it('sem ffmpeg é bloqueio; sem sandbox é ressalva (auto) ou bloqueio (required); Windows não tem sandbox verificado', () => {
    const noFfmpeg = checkEnvironment(config, (b) => b !== 'ffmpeg', 'linux');
    expect(noFfmpeg.blockers.join('\n')).toMatch(/FFmpeg/);
    const win = checkEnvironment(config, () => true, 'win32');
    expect(win.warnings.join('\n')).toMatch(/Isolamento dos agentes.*não verificado/);
    expect(win.blockers.join('\n')).not.toMatch(/Isolamento/);
    const req = checkEnvironment(loadConfig({ MD2_AGENT_SANDBOX: 'required' }, ROOT), (b) => b !== 'bwrap', 'linux');
    expect(req.blockers.join('\n')).toMatch(/Isolamento dos agentes/);
  });
});
