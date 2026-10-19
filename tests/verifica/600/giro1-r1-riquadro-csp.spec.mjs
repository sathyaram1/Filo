// #600 giro 1: dentro un riquadro incorporato con CSP i pezzi di Filo (menu del tasto destro, pannello
// "Invia attacco") devono avere lo stile come nella pagina principale.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { apriRedteamATutti } from '../../helpers/redteam.mjs';

const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
const DENTRO = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
  <div id="p" style="height:100vh;padding:20px">Chat incorporata, tasto destro qui.</div></body></html>`;

let fuori, dentro, origineFuori, origineDentro;
test.beforeAll(async () => {
  dentro = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
    res.end(DENTRO);
  });
  await new Promise((r) => dentro.listen(0, '127.0.0.1', r));
  origineDentro = `http://localhost:${dentro.address().port}/`;
  fuori = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body style="margin:0">
      <iframe src="${origineDentro}" style="width:900px;height:700px;border:0"></iframe></body></html>`);
  });
  await new Promise((r) => fuori.listen(0, '127.0.0.1', r));
  origineFuori = `http://127.0.0.1:${fuori.address().port}/`;
});
test.afterAll(async () => {
  await new Promise((r) => fuori.close(r));
  await new Promise((r) => dentro.close(r));
});

test('r1 nel riquadro con CSP il menu del tasto destro e il pannello "Invia attacco" hanno lo stile di Filo', async ({ app, shell }) => {
  await apriRedteamATutti(app);
  const port = new URL(origineFuori).port;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origineFuori);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return new URL(w.url()).port === port; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 12_000 }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#p')).toBeVisible();

  const menu = frame.locator('.sn-menu').first();
  await expect.poll(async () => {
    await frame.locator('#p').press('Escape').catch(() => {});
    await frame.locator('#p').click({ button: 'right', position: { x: 200, y: 120 } });
    return menu.isVisible();
  }, { timeout: 15_000 }).toBe(true);
  const posMenu = await menu.evaluate((el) => getComputedStyle(el).position);
  expect(posMenu, 'menu.css non applicato nel riquadro con CSP').toBe('fixed');

  await frame.locator('.sn-menu .sn-menu-item', { hasText: 'Invia attacco' }).first().click();
  const overlay = frame.locator('.sn-rt-overlay');
  await expect(overlay.locator('.sn-rt-modal')).toBeVisible();
  const pos = await overlay.evaluate((el) => getComputedStyle(el).position);
  expect(pos, 'redteam-attack.css non applicato nel riquadro con CSP').toBe('fixed');
});
