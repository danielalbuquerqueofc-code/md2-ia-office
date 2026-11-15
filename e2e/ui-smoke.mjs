// Teste E2E de interface: sobe o servidor compilado com dados temporários e senha, e percorre
// todas as telas em desktop e celular verificando login, erros de console e rolagem horizontal.
// Requer `npm run build`. Uso: npm run e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// Playwright pode estar instalado globalmente; require respeita NODE_PATH, import ESM não.
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const port = 4398;
const base = `http://127.0.0.1:${port}`;
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'md2-e2e-'));
const server = spawn(process.execPath, ['dist/server/index.js'], {
  env: { ...process.env, MD2_PORT: String(port), MD2_DATA_DIR: data, MD2_ADMIN_PASSWORD: 'e2e-senha' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };

try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  const browser = await chromium.launch();
  const routes = ['comando', 'execucoes', 'equipe', 'conhecimento', 'ferramentas', 'entregaveis', 'aprovacoes', 'historico', 'configuracoes'];
  for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['celular', devices['iPhone 13']], ['tablet', devices['iPad Mini']]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errors.push(m.text()));
    await page.goto(base);
    await page.waitForSelector('input[type=password]');
    await page.fill('input[type=password]', 'errada');
    await page.click('button:has-text("Entrar")');
    check(await page.locator('.banner.err').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), `${label}: senha errada é recusada`);
    await page.fill('input[type=password]', 'e2e-senha');
    await page.click('button:has-text("Entrar")');
    await page.waitForSelector('.welcome');
    check(await page.locator('textarea[aria-label="Mensagem para Alfred"]').isVisible(), `${label}: Alfred é a primeira tela`);
    for (const r of routes) {
      await page.goto(`${base}/#/${r}`);
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 1, `${label}: /${r} sem rolagem horizontal (${overflow}px)`);
    }
    await page.goto(`${base}/#/equipe`);
    await page.waitForSelector('.card.click');
    check((await page.locator('.card.click').count()) === 22, `${label}: 22 agentes listados`);
    check(errors.length === 0, `${label}: sem erros de console ${errors.length ? JSON.stringify(errors) : ''}`);
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
  fs.rmSync(data, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} falha(s)` : '\nTodos os testes de interface passaram.');
process.exit(failures.length ? 1 : 0);
