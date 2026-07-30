// Feedback #2 + #281: la cronologia dev'essere un pulsante in alto a destra nella
// home. Con #281 la pagina PRINCIPALE di cronologia è quella delle schede
// visitate/chiuse (filo://archive), non più il log delle azioni AI (che resta
// raggiungibile da lì come "Cronologia AI"). Questo test ASSERISCE che:
//   1) tra i controlli in alto a destra della home esiste un pulsante Cronologia;
//   2) cliccandolo si apre davvero la pagina della cronologia schede (filo://archive).
// Senza il pulsante (o se aprisse altro), il test è rosso.

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

test('la home ha un pulsante Cronologia in alto a destra che apre la cronologia schede', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Il pulsante esiste tra i controlli della home (#dashControls).
  const histBtn = page.locator('#dashControls .dash-ctrl[data-command="history"]');
  await expect(histBtn).toBeVisible({ timeout: 8_000 });

  // Cliccandolo si apre una scheda sulla pagina della cronologia.
  await histBtn.click();
  const deadline = Date.now() + 10_000;
  let opened = null;
  while (Date.now() < deadline) {
    opened = app.windows().find((w) => w.url().includes('filo://history/'));
    if (opened) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(opened, 'la pagina cronologia non si è aperta dopo il click').toBeTruthy();
});
