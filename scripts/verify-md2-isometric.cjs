// Read-only browser verification: never submits a task or starts an AI session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

async function verify() {
  const url = process.env.MD2_PREVIEW_URL || 'http://127.0.0.1:4330';
  const token = process.env.MD2_PREVIEW_TOKEN;
  assert(token, 'Set MD2_PREVIEW_TOKEN for the local operator session');
  const output = path.resolve(process.env.MD2_SCREENSHOT_DIR || 'test-results/md2-layout');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const received = [];
    page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        try {
          received.push(JSON.parse(String(payload)));
        } catch {
          /* Non-JSON frames are unrelated. */
        }
      }),
    );
    const errors = [];
    const failedResponses = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const before = await context.request.get(`${url}/api/md2/state`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(before.status(), 200);
    const initial = await before.json();
    assert.equal(initial.departments.length, 7);
    assert.equal(
      initial.departments.reduce((sum, d) => sum + d.positions, 0),
      20,
    );
    assert.equal((await context.request.get(`${url}/api/md2/state`)).status(), 401);
    await page.goto(`${url}/?token=${encodeURIComponent(token)}`);
    await page.locator('html.md2-dashboard').waitFor();
    await page.getByRole('button', { name: 'Escritório', exact: true }).waitFor();
    const canvas = page.getByTestId('md2-isometric-scene');
    await canvas.waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[data-workstation]').count(), 21);
    assert.equal(await page.locator('[data-character-kind=planned]').count(), 22);
    assert.equal(await page.locator('[data-character-kind=session]').count(), 0);
    assert.equal(await page.locator('[data-room]').count(), 9);
    assert.equal(
      await page
        .locator('.iso-person-planned')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      'iso-idle',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.iso-person-planned')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.screenshot({ path: path.join(output, 'md2-isometric-desktop.png') });
    const mappings = received.find((message) => message.type === 'areaMappingsLoaded');
    assert(mappings?.mappings['Tecnologia · Codex'].includes('Tecnologia'));
    const map = received.find((message) => message.type === 'layoutLoaded')?.layout;
    assert.equal(map?.areas.length, 8);
    assert.equal(map?.furniture.filter((item) => item.type === 'CUSHIONED_BENCH').length, 21);
    await page.getByRole('button', { name: 'Aprovações', exact: true }).click();
    await page.getByRole('heading', { name: /Centro de aprovações/ }).waitFor();
    await page.screenshot({ path: path.join(output, 'md2-isometric-aprovacoes.png') });
    await page.getByRole('button', { name: 'Recolher', exact: true }).click();
    await page.getByRole('button', { name: /Tecnologia · 4 cargos planejados/ }).press('Enter');
    await page.getByRole('heading', { name: /Centro de aprovações/ }).waitFor();
    await page.getByRole('button', { name: 'Recolher', exact: true }).click();
    await page.setViewportSize({ width: 1366, height: 679 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: path.join(output, 'md2-isometric-compacto.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Escritório', exact: true }).click();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await page.screenshot({ path: path.join(output, 'md2-isometric-mobile.png') });
    assert(await canvas.isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const after = await context.request.get(`${url}/api/md2/state`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const final = await after.json();
    assert.equal(final.tasks.length, initial.tasks.length);
    assert.deepEqual(final.tasks, initial.tasks);
    assert.deepEqual(final.approvals, initial.approvals);
    assert.equal(final.busy, initial.busy);
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    console.log(
      JSON.stringify({
        screenshots: 4,
        departments: 7,
        positions: 20,
        taskCountUnchanged: true,
        pageErrors: errors,
        unauthorizedState: 401,
      }),
    );
  } finally {
    await browser.close();
  }
}
verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
