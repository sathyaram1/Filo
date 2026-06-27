// Regression test per la parte del feedback "tutto Filo (anche la barra in alto)
// va in penombra quando si annota". Il box feedback vive in un content script
// sulla pagina (WebContentsView) e da lì può oscurare solo l'area pagina:
// l'ombra sulla barra in alto deve arrivare dalla shell, via IPC.
//
// Asserisce IL SUCCESSO della feature: quando il box è aperto la shell mostra
// il velo `#feedback-dim`; quando si chiude (o si cambia tab) il velo sparisce.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

test('aprendo il box feedback la barra in alto di Filo va in penombra; chiudendolo torna normale', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  const shellHeader = shell.locator('header.shell');
  const isDimmed = () => shell.evaluate(() =>
    document.documentElement.dataset.feedbackDim === '1'
    && getComputedStyle(document.querySelector('header.shell')).filter.includes('brightness'));

  // Prima dell'apertura: la barra in alto è a piena luminosità.
  await expect(shellHeader).toHaveCount(1, { timeout: 8_000 });
  expect(await isDimmed()).toBe(false);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // La barra in alto di Filo ora è in penombra (filtro brightness applicato),
  // non solo l'area pagina: tutto Filo entra in modalità annotazione.
  await expect.poll(isDimmed, { timeout: 4_000 }).toBe(true);

  // Chiudendo il box la penombra della shell sparisce: Filo torna luminoso.
  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await expect.poll(isDimmed, { timeout: 4_000 }).toBe(false);
});

test('cambiando tab mentre il box è aperto il velo della shell non resta appeso', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  const dimAttr = shell.locator('html[data-feedback-dim="1"]');
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(dimAttr).toHaveCount(1, { timeout: 4_000 });

  // Apre un secondo tab: la tab attiva cambia, il content script di prima non
  // riceve più eventi → la shell deve togliere la penombra da sola.
  await openTab('filo://newtab/');
  await expect(dimAttr).toHaveCount(0, { timeout: 4_000 });
});
