// Feedback #155, poi #869: la home non chiama il modello aprendosi. I suggerimenti si rifanno quando Filo scrive per
// primo (o con «Aggiorna»), e la home aperta li riceve DA SOLA col broadcast FILO_DASHBOARD_UPDATED, senza ricaricare.
// Arrivato un modello, la frase che spiegava perché Filo non poteva rispondere se ne va.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('la home si aggiorna live al broadcast FILO_DASHBOARD_UPDATED', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });

  // Tipo messaggio dal catalogo condiviso (niente stringhe magiche nel test).
  const type = await page.evaluate(() => window.SN_MSG.MSG.FILO_DASHBOARD_UPDATED);

  // Il main spinge l'aggiornamento come fa generaPerFiloParla (src/main/services/handlers.js).
  await app.evaluate(({ BrowserWindow }, t) => {
    const msg = {
      type: t,
      suggestions: [{ icon: 'link', text: 'Suggerimento ricalcolato', action: null, importance: 3 }],
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (win._filoTabs) {
        for (const tab of win._filoTabs.tabs) {
          try { tab.view.webContents.send('filo:broadcast', msg); } catch (_) {}
        }
      }
      try { win.webContents.send('filo:broadcast', msg); } catch (_) {}
    }
  }, type);

  await expect(page.locator('#homeMessage')).toBeHidden({ timeout: 8_000 });
  await expect(page.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce'))
    .toContainText('Suggerimento ricalcolato', { timeout: 8_000 });
});
