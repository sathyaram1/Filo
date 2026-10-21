// Verifica che le azioni della finestra della barra laterale funzionino dopo il
// refactor da estensione MV3 a Electron app: back, forward, reload, close.
// Fullscreen è verificato separatamente perché agisce sulla BrowserWindow
// (non sulla view). Da #871/#1246 le icone stanno nella barra laterale.

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

const HTML_A = `<!doctype html><html><body><h1 id="t">pagina A</h1></body></html>`;
const HTML_B = `<!doctype html><html><body><h1 id="t">pagina B</h1></body></html>`;

test('back/forward dalla barra navigano nella history', async ({ app, openTab, testServer }) => {
  const urlA = testServer.html(HTML_A);
  const urlB = testServer.html(HTML_B);
  const page = await openTab(urlA);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // Naviga a B nello stesso tab
  await page.goto(urlB);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(page.locator('#t')).toHaveText('pagina B');

  const back = await iconaDellaBarra(app, 'back');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await expect(page.locator('#t')).toHaveText('pagina A', { timeout: 5000 });
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Forward: deve tornare a B
  const fwd = await iconaDellaBarra(app, 'forward');
  await expect(fwd).toHaveAttribute('aria-disabled', 'false');
  await fwd.click();
  await expect(page.locator('#t')).toHaveText('pagina B', { timeout: 5000 });
});

test('reload dalla barra ricarica la pagina', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // Marker che sopravvive solo finché non c'è reload.
  await page.evaluate(() => { window.__marker = 'before-reload'; });
  expect(await page.evaluate(() => window.__marker)).toBe('before-reload');

  await (await iconaDellaBarra(app, 'reload')).click();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1' && window.__marker === undefined, null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__marker)).toBeUndefined();
});

test('close (chiudi tab) dalla barra chiude la tab', async ({ openTab, testServer, app, shell }) => {
  // Ho 2 tab: newtab (boot) + la pagina A. Dopo close → solo newtab.
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(shell.locator('.tab')).toHaveCount(2);

  await (await iconaDellaBarra(app, 'closeTab')).click();
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 4000 });
  expect(app.windows().some((w) => { try { return w.url() === page.url(); } catch (_) { return false; } })).toBe(false);
});
