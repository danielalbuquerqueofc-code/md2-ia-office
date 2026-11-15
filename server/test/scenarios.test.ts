import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ROOT } from './helpers.js';

type Check = { ok: boolean; nome: string; detalhe: string };
const load = async (f: string) => (await import(pathToFileURL(path.join(ROOT, 'e2e', f)).href)) as Record<string, any>;
const { SCENARIOS, classify } = await load('scenarios.mjs');
const { verifyVideo, verifySite } = await load('verify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-scn-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ok: Check[] = [{ ok: true, nome: 'x', detalhe: '' }];
const task = (agent_id: string, status = 'concluida') => ({ agent_id, status });
const base = (cenario: 'a' | 'b') => ({
  cenario, execStatus: 'concluido', independentChecks: ok, sandboxActive: true, materialAtestado: true, preflight: { suspectedSynthetic: false, cameraEvidence: 3 },
  tasks: cenario === 'a' ? [task('lucas'), task('andre'), task('sofia'), task('amanda')] : [task('diego'), task('isabela'), task('sofia')],
  deliverables: cenario === 'a' ? [{ category: 'site', versions: [{ kind: 'site' }] }] : [{ category: 'video', versions: [{ kind: 'video' }] }],
});

describe('pedidos dos cenários: só o que o usuário informou', () => {
  it('cenário B usa o nome da pasta, não o caminho completo, e a duração pedida', () => {
    const p = SCENARIOS.b.prompt({ pasta: '/Users/daniel/Clientes/Pão de Mel', tema: 'o café da tarde', duracao: 30 });
    expect(p).toContain('pasta Pão de Mel');
    expect(p).not.toContain('/Users/daniel');
    expect(p).toMatch(/Reels de 30 segundos sobre o café da tarde/);
    expect(p).toMatch(/legenda/);
  });
  it('cenário A inclui apenas os links e informações fornecidos, sem inventar nenhum dado do cliente', () => {
    const p = SCENARIOS.a.prompt({ maps: 'https://maps.app.goo.gl/x' });
    expect(p).toContain('Google Maps: https://maps.app.goo.gl/x');
    expect(p).not.toMatch(/Instagram:|Site atual:|Informações fornecidas/);
    expect(p).toMatch(/R\$ 2\.000/);
    expect(p).toMatch(/oportunidades comerciais.*posicionamento/);
    const full = SCENARIOS.a.prompt({ maps: 'm', instagram: 'i', site: 's', briefing: 'atende de segunda a sexta', anexos: ['/x/logo.png'] });
    expect(full).toMatch(/Instagram: i[\s\S]*Site atual: s[\s\S]*logo\.png[\s\S]*atende de segunda a sexta/);
  });
});

describe('classificação honesta dos cenários', () => {
  it('cenário B com tudo certo e material atestado é VALIDADO', () => {
    expect(classify(base('b')).nivel).toBe('VALIDADO');
  });
  it('B sem atestado do usuário NÃO é validado', () => {
    const r = classify({ ...base('b'), materialAtestado: false });
    expect(r.nivel).toBe('NAO_VALIDADO');
    expect(r.motivos.join()).toMatch(/não atestou que o material é real/);
  });
  it('B com material suspeito de sintético NÃO é validado, mesmo atestado e com todas as verificações passando', () => {
    const r = classify({ ...base('b'), preflight: { suspectedSynthetic: true, cameraEvidence: 0 } });
    expect(r.nivel).toBe('NAO_VALIDADO');
    expect(r.motivos.join()).toMatch(/sintético ou de teste/);
  });
  it('B sem metadados de câmera mas sem outros indícios é VALIDADO COM RESSALVAS', () => {
    const r = classify({ ...base('b'), preflight: { suspectedSynthetic: false, cameraEvidence: 0 } });
    expect(r.nivel).toBe('VALIDADO_COM_RESSALVAS');
    expect(r.avisos.join()).toMatch(/declaração/);
  });
  it('sem sandbox, sem QA concluído, agente não acionado ou verificação independente falha: NÃO validado', () => {
    expect(classify({ ...base('a'), sandboxActive: false }).motivos.join()).toMatch(/sandbox/);
    expect(classify({ ...base('a'), tasks: [task('andre'), task('sofia', 'falhou')] }).motivos.join()).toMatch(/tarefa de sofia não foi concluída/);
    expect(classify({ ...base('b'), tasks: [task('isabela'), task('sofia')] }).motivos.join()).toMatch(/não acionou diego/);
    const f = classify({ ...base('a'), independentChecks: [{ ok: false, nome: '360px: sem rolagem horizontal', detalhe: '40px' }] });
    expect(f.nivel).toBe('NAO_VALIDADO');
    expect(f.motivos.join()).toMatch(/verificação independente falhou: 360px/);
    expect(classify({ ...base('a'), execStatus: 'falhou' }).nivel).toBe('NAO_VALIDADO');
    expect(classify({ ...base('b'), deliverables: [] }).motivos.join()).toMatch(/nenhum entregável do tipo video/);
  });
  it('aguardando aprovação conta como execução concluída; avisos do preflight viram ressalvas', () => {
    const r = classify({ ...base('a'), execStatus: 'aguardando_aprovacao', avisos: ['Instagram sem leitura pública'] });
    expect(r.nivel).toBe('VALIDADO_COM_RESSALVAS');
    expect(r.avisos).toContain('Instagram sem leitura pública');
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
describe.skipIf(!hasFfmpeg)('verificação independente de vídeo (amostras geradas só para testar o verificador)', () => {
  const mk = (name: string, size: string, src = 'testsrc2', secs = 2, rate = 30) => {
    const f = path.join(tmp, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${src}${src.includes('=') ? ':' : '='}s=${size}:r=${rate}`, '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000', '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
    if (r.status !== 0) throw new Error(String(r.stderr));
    return f;
  };
  it('aprova um vídeo 1080x1920, 30 fps, H.264+AAC, na duração pedida', () => {
    const r: Check[] = verifyVideo(mk('bom.mp4', '1080x1920'), { seconds: 2 });
    expect(r.filter((c) => !c.ok)).toEqual([]);
  });
  it('reprova duração, resolução e fps errados, e vídeo majoritariamente preto', () => {
    const f = mk('ruim.mp4', '1280x720', 'testsrc2', 2, 25);
    const falhas = (verifyVideo(f, { seconds: 30 }) as Check[]).filter((c) => !c.ok).map((c) => c.nome);
    expect(falhas).toEqual(expect.arrayContaining(['resolução 1080x1920 (9:16)', '30 quadros por segundo', 'duração 30 s ±0,5']));
    const preto = mk('preto.mp4', '1080x1920', 'color=c=black', 2);
    expect((verifyVideo(preto, { seconds: 2 }) as Check[]).filter((c) => !c.ok).map((c) => c.nome)).toContain('não é majoritariamente preto');
  });
  it('arquivo que não é vídeo reprova na leitura', () => {
    const f = path.join(tmp, 'lixo.mp4'); fs.writeFileSync(f, 'nada');
    expect((verifyVideo(f) as Check[])[0].ok).toBe(false);
  });
});

let hasPlaywright = true;
try { createRequire(import.meta.url)('playwright'); } catch { hasPlaywright = false; }
describe.skipIf(!hasPlaywright)('verificação independente de site (sites mínimos gerados só para testar o verificador)', () => {
  const page = (body: string, head = '') => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Padaria Exemplo | Campinas</title><meta name="description" content="Pães e bolos em Campinas.">${head}</head><body>${body}</body></html>`;
  const site = (name: string, html: string) => { const d = path.join(tmp, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'index.html'), html); return d; };

  it('aprova um site correto', async () => {
    const d = site('bom', page('<main><h1>Padaria Exemplo</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Logo"><a href="https://wa.me/5519999990000">WhatsApp</a><a href="#cardapio">Cardápio</a><section id="cardapio">x</section></main>'));
    const r: Check[] = await verifySite(d);
    expect(r.filter((c) => !c.ok)).toEqual([]);
  }, 60_000);

  it('reprova rolagem horizontal, h1 duplicado, imagem sem alt, sem WhatsApp, âncora quebrada, lorem e erro de console', async () => {
    const d = site('ruim', page('<h1>A</h1><h1>B</h1><div style="width:2000px">largo</div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="#inexistente">x</a><p>Lorem ipsum dolor</p>', '<script>throw new Error("falha proposital")</script>'));
    const falhas = ((await verifySite(d)) as Check[]).filter((c) => !c.ok).map((c) => c.nome);
    expect(falhas).toEqual(expect.arrayContaining(['360px: sem rolagem horizontal', '360px: sem erros de console', 'um único h1', 'todas as imagens têm alt', 'link de WhatsApp presente', 'sem "lorem ipsum"', 'âncoras internas existem']));
  }, 60_000);

  it('pasta sem index.html reprova', async () => {
    const d = path.join(tmp, 'vazio'); fs.mkdirSync(d);
    expect(((await verifySite(d)) as Check[])[0]).toMatchObject({ ok: false, nome: 'index.html na raiz' });
  });
});
