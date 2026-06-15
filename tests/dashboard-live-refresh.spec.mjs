// Feedback #155: la schermata home non deve più rigenerarsi (lenta, con l'LLM)
// a ogni apertura di scheda. La nuova scheda serve la cache all'istante e il
// ricalcolo avviene in background; quando è pronto, la home si aggiorna DA SOLA
// via il broadcast FILO_DASHBOARD_UPDATED.
//
// Questo test ASSERISCE il cablaggio lato client: quando arriva quel broadcast
// (esattamente come lo emette il ricalcolo in background nel main), il messaggio
// centrale e i suggerimenti della home si aggiornano senza ricaricare nulla.

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

  // Il main spinge l'aggiornamento esattamente come fa broadcastToTabs nel
  // ricalcolo in background (#155).
  await app.evaluate(({ BrowserWindow }, t) => {
    const msg = {
      type: t,
      message: 'Messaggio ricalcolato in background',
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

  // Il messaggio centrale si è aggiornato (senza ricaricare la pagina)…
  await expect(page.locator('#homeMessage')).toHaveText('Messaggio ricalcolato in background', { timeout: 8_000 });
  // …e così i suggerimenti nella colonna.
  await expect(page.locator('.dash-suggestion'))
    .toContainText('Suggerimento ricalcolato', { timeout: 8_000 });
});
