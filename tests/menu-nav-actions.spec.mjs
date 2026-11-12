// Le azioni sulla finestra dalla barra laterale fanno quello che dicono: indietro e avanti nella cronologia della
// scheda, ricarica, chiudi scheda. Lo schermo intero ha le sue prove (schermo-intero-tasto, barra-laterale).

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

const HTML_A = `<!doctype html><html><body><h1 id="t">pagina A</h1></body></html>`;
const HTML_B = `<!doctype html><html><body><h1 id="t">pagina B</h1></body></html>`;

const pronta = (page) => page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

test('back/forward dalla barra laterale navigano nella history', async ({ openTab, testServer, app }) => {
  const urlA = testServer.html(HTML_A);
  const urlB = testServer.html(HTML_B);
  const page = await openTab(urlA);
  await pronta(page);
  await page.goto(urlB);
  await pronta(page);
  await expect(page.locator('#t')).toHaveText('pagina B');

  await premiNellaBarra(app, 'back');
  await expect(page.locator('#t')).toHaveText('pagina A', { timeout: 5000 });
  await pronta(page);

  await premiNellaBarra(app, 'forward');
  await expect(page.locator('#t')).toHaveText('pagina B', { timeout: 5000 });
});

test('reload dalla barra laterale ricarica la pagina', async ({ openTab, testServer, app }) => {
  const page = await openTab(testServer.html(HTML_A));
  await pronta(page);
  // Un segno che sopravvive solo finché la pagina non si ricarica.
  await page.evaluate(() => { window.__marker = 'before-reload'; });
  expect(await page.evaluate(() => window.__marker)).toBe('before-reload');

  await premiNellaBarra(app, 'reload');
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1' && window.__marker === undefined, null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__marker)).toBeUndefined();
});

test('chiudi scheda dalla barra laterale chiude la scheda davanti', async ({ openTab, testServer, app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const page = await openTab(testServer.html(HTML_A));
  await pronta(page);
  await expect(shell.locator('.tab')).toHaveCount(2);

  await premiNellaBarra(app, 'closeTab');
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 4000 });
});
