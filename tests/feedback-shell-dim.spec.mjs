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

  // Prima dell'apertura: nessun velo sulla shell.
  await expect(shell.locator('#feedback-dim')).toHaveCount(0);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // La shell (barra in alto di Filo) ora è coperta dal velo d'ombra, che è
  // semi-trasparente e mostra il cursore a mirino (modalità annotazione).
  const veil = shell.locator('#feedback-dim');
  await expect(veil).toHaveCount(1, { timeout: 4_000 });
  const style = await veil.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { cursor: cs.cursor, position: cs.position, bg: cs.backgroundColor };
  });
  expect(style.cursor).toBe('crosshair');
  expect(style.position).toBe('fixed');
  // Sfondo nero semi-trasparente: si vede ancora sotto.
  expect(style.bg).toMatch(/rgba?\(0,\s*0,\s*0/);

  // Chiudendo il box il velo della shell sparisce: Filo torna luminoso.
  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
  await expect(veil).toHaveCount(0, { timeout: 4_000 });
});

test('cambiando tab mentre il box è aperto il velo della shell non resta appeso', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(shell.locator('#feedback-dim')).toHaveCount(1, { timeout: 4_000 });

  // Apre un secondo tab: la tab attiva cambia, il content script di prima non
  // riceve più eventi → la shell deve togliere il velo da sola.
  await openTab('filo://newtab/');
  await expect(shell.locator('#feedback-dim')).toHaveCount(0, { timeout: 4_000 });
});
