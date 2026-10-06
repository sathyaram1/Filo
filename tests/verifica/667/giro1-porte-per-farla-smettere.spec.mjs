// Verifica #667 — giro 1, seconda parte: le strade per far SMETTERE il rumore.
//
// Una suoneria che non si può fermare è peggio di una che non parte. Qui si
// contano le porte: la × della scheda accanto a «Ferma», e la pagina a tutto
// schermo, che copre la striscia dove vive il chip.

import { test, expect } from '../../fixtures/electron.mjs';

const suona = (shell) => shell.evaluate(() => window.SN_SOUNDS.isRinging());

async function newtab(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('la × della scheda zittisce la shell come «Ferma»', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtab(app);
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Riso', seconds: 2 }), tipo);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  expect(await suona(shell)).toBe(true);

  await page.locator('#live .dash-live-card[data-ringing="1"] .dash-live-dismiss').click();

  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  await shell.waitForTimeout(1200);
  expect(await suona(shell)).toBe(false);
});

// Il chip vive nella striscia dei tab perché è «l'unica mai coperta dalla
// pagina». A tutto schermo però la view prende anche quella: il suono partiva e
// non c'era niente da premere, né un tasto che zittisse. Alla scadenza adesso
// Filo esce dal tutto schermo da solo.
test('pagina a tutto schermo: alla scadenza la finestra rientra e il chip si preme', async ({ app, shell, testServer, openTab }) => {
  const pieno = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.contentFullscreen;
  });

  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await testServer.openReady(openTab, '<html><body><h1>video</h1></body></html>');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.setContentFullscreen(true);
  });
  expect(await pieno()).toBe(true);

  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate((t) => window.filoShell.message({ type: t, label: 'Forno', seconds: 2 }), tipo);

  await expect(shell.locator('#ring-indicator')).toBeVisible({ timeout: 12_000 });
  expect(await suona(shell)).toBe(true);

  // Senza rientrare dal tutto schermo la striscia resta sotto la pagina e il
  // clic qui sotto finirebbe nel vuoto.
  await expect.poll(pieno, { timeout: 20_000 }).toBe(false);
  await shell.locator('#ring-indicator').click();
  await expect(shell.locator('#ring-indicator')).toBeHidden({ timeout: 6_000 });
  expect(await suona(shell)).toBe(false);
});
