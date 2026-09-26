// #686, primo giro — COME SI VEDE LA VOCE NUOVA.
//
// La voce dello zoom entra nel menu del tasto destro, che è la superficie più
// usata di Filo. Qui si guarda davvero: tema chiaro e tema scuro, la voce sta in
// riga con le altre, il numero si legge e la scorciatoia è quella vera.
// Gli scatti finiscono in tests/.shots/ e si guardano a mano.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head>
<body style="font:16px system-ui;padding:24px"><h1>una pagina qualunque</h1>
<p>testo da ingrandire</p></body></html>`;

const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents } });
  }, { action });

test('la voce dello zoom nel menu: chiaro e scuro', async ({ app, openTab, testServer }) => {
  mkdirSync('tests/.shots', { recursive: true });
  const page = await testServer.openReady(openTab, PAGINA);

  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await page.waitForTimeout(400);

  for (const tema of ['light', 'dark']) {
    await execAction(app, { type: 'IMPOSTA_PREFERENZA', chiave: 'theme', valore: tema === 'dark' ? 'scuro' : 'chiaro' })
      .catch(() => {});
    // Il tema si impone anche a mano: la prova serve a GUARDARE, non a provare
    // la strada delle preferenze.
    await page.evaluate((t) => {
      document.documentElement.dataset.snTheme = t;
      document.documentElement.setAttribute('data-theme', t);
    }, tema);
    await page.locator('h1').click({ button: 'right' });
    const menu = page.locator('.sn-menu').first();
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/Dimensione reale \(ora 150%\)/)).toBeVisible();
    await page.screenshot({ path: `tests/.shots/686-menu-zoom-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
});
