// Verificação INDEPENDENTE dos entregáveis: não confia no que os agentes dizem; mede os arquivos.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });

export function verifyVideo(file, { seconds = 30 } = {}) {
  const checks = [];
  const add = (ok, nome, detalhe = '') => checks.push({ ok, nome, detalhe });
  const p = sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (p.status !== 0) return [{ ok: false, nome: 'ffprobe lê o arquivo', detalhe: p.stderr.slice(0, 200) }];
  const j = JSON.parse(p.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const dur = Number(j.format.duration);
  add(v?.codec_name === 'h264', 'vídeo H.264', v?.codec_name);
  add(!!a && a.codec_name === 'aac', 'áudio AAC presente', a?.codec_name ?? 'sem áudio');
  add(v?.width === 1080 && v?.height === 1920, 'resolução 1080x1920 (9:16)', `${v?.width}x${v?.height}`);
  const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  add(d > 0 && Math.abs(n / d - 30) < 0.5, '30 quadros por segundo', `${d ? (n / d).toFixed(2) : '?'}`);
  add(Math.abs(dur - seconds) <= 0.5, `duração ${seconds} s ±0,5`, `${dur.toFixed(2)} s`);
  add(fs.statSync(file).size < 100 * 1024 * 1024, 'menos de 100 MB', `${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
  const dec = sh('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  add(dec.status === 0 && !dec.stderr.trim(), 'decodifica de ponta a ponta sem erro', dec.stderr.trim().split('\n')[0]);
  const bl = sh('ffmpeg', ['-i', file, '-vf', 'blackdetect=d=0.5:pix_th=0.1', '-an', '-f', 'null', '-']);
  const black = [...bl.stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  add(black < dur * 0.5, 'não é majoritariamente preto', `${black.toFixed(1)} s de preto`);
  return checks;
}

function serve(dir) {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };
  const server = http.createServer((req, res) => {
    let p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': mime[path.extname(p)] ?? 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

export async function verifySite(dir, { evidenceDir } = {}) {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const checks = [];
  const add = (ok, nome, detalhe = '') => checks.push({ ok, nome, detalhe });
  if (!fs.existsSync(path.join(dir, 'index.html'))) return [{ ok: false, nome: 'index.html na raiz', detalhe: dir }];
  const { server, port } = await serve(dir);
  const browser = await chromium.launch();
  try {
    for (const w of [360, 768, 1280]) {
      const page = await browser.newPage({ viewport: { width: w, height: 800 } });
      const errors = [], failed = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('requestfailed', (r) => failed.push(r.url()));
      page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForTimeout(600);
      // percorre a página para disparar animações de entrada antes da captura
      const h = await page.evaluate(() => document.body.scrollHeight);
      for (let y = 0; y < h; y += 500) { await page.evaluate((yy) => scrollTo(0, yy), y); await page.waitForTimeout(80); }
      await page.evaluate(() => scrollTo(0, 0));
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        h1: document.querySelectorAll('h1').length, title: document.title,
        desc: document.querySelector('meta[name=description]')?.content ?? '',
        semAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        wa: document.querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"]').length,
        lorem: /lorem ipsum/i.test(document.body.innerText),
        pendentes: (document.body.innerText.match(/\[?A CONFIRMAR|\[CONFIRMAR/gi) ?? []).length,
        anchorsQuebradas: [...document.querySelectorAll('a[href^="#"]')].filter((a) => a.getAttribute('href').length > 1 && !document.querySelector(a.getAttribute('href'))).length,
      }));
      add(info.overflow <= 1, `${w}px: sem rolagem horizontal`, `${info.overflow}px`);
      add(errors.length === 0, `${w}px: sem erros de console`, errors[0] ?? '');
      add(failed.length === 0, `${w}px: nenhum recurso falhou`, failed[0] ?? '');
      if (w === 1280) {
        add(info.h1 === 1, 'um único h1', String(info.h1));
        add(info.title.length > 0 && info.title.length <= 60, 'title preenchido e até 60 caracteres', `${info.title.length}: ${info.title}`);
        add(info.desc.length > 0 && info.desc.length <= 160, 'meta description preenchida e até 160 caracteres', String(info.desc.length));
        add(info.semAlt === 0, 'todas as imagens têm alt', String(info.semAlt));
        add(info.wa >= 1, 'link de WhatsApp presente', String(info.wa));
        add(!info.lorem, 'sem "lorem ipsum"');
        add(info.anchorsQuebradas === 0, 'âncoras internas existem', String(info.anchorsQuebradas));
        add(true, `informativo: ${info.pendentes} marcador(es) "A CONFIRMAR" visível(is) (conteúdo ainda pendente do cliente)`);
      }
      if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); await page.screenshot({ path: path.join(evidenceDir, `site-${w}.png`), fullPage: true }); }
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
  return checks;
}
