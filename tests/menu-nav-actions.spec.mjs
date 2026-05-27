// Verifica che le azioni "impostazioni rapide" (icona riga del menu tasto-destro)
// funzionino dopo il refactor da estensione MV3 a Electron app:
// back, forward, reload, close. Fullscreen è verificato separatamente perché
// agisce sulla BrowserWindow (non sulla view).

import { test, expect } from './fixtures/electron.mjs';

const HTML_A = `<!doctype html><html><body><h1 id="t">pagina A</h1></body></html>`;
const HTML_B = `<!doctype html><html><body><h1 id="t">pagina B</h1></body></html>`;

async function openOverflowGrid(page) {
  await page.locator('h1').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });
  return grid;
}

test('back/forward dal menu icone navigano nella history', async ({ openTab, testServer }) => {
  const urlA = testServer.html(HTML_A);
  const urlB = testServer.html(HTML_B);
  const page = await openTab(urlA);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // Naviga a B nello stesso tab
  await page.goto(urlB);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(page.locator('#t')).toHaveText('pagina B');

  // Apre il menu → overflow grid → click 'back'
  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]').click();
  // Attendo il caricamento di A
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const txt = await page.locator('#t').textContent().catch(() => '');
    if (txt === 'pagina A') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(page.locator('#t')).toHaveText('pagina A');

  // Forward: deve tornare a B
  const grid2 = await openOverflowGrid(page);
  await grid2.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]').click();
  const deadline2 = Date.now() + 5000;
  while (Date.now() < deadline2) {
    const txt = await page.locator('#t').textContent().catch(() => '');
    if (txt === 'pagina B') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await expect(page.locator('#t')).toHaveText('pagina B');
});

test('reload dal menu icone ricarica la pagina', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  // Marker che sopravvive solo finché non c'è reload.
  await page.evaluate(() => { window.__marker = 'before-reload'; });
  expect(await page.evaluate(() => window.__marker)).toBe('before-reload');

  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="reload"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1' && window.__marker === undefined, null, { timeout: 8000 });
  expect(await page.evaluate(() => window.__marker)).toBeUndefined();
});

test('close (chiudi tab) dal menu icone chiude la tab', async ({ openTab, testServer, app, shell }) => {
  // Ho 2 tab: newtab (boot) + la pagina A. Dopo close → solo newtab.
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8000 });
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  await expect(shell.locator('.tab')).toHaveCount(2);

  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="closeTab"]').click();
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 4000 });
});
