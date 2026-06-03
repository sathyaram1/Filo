// Test della feature "disegna su TUTTA l'app Filo (anche tab e barra in alto)".
// La barra in alto vive nella shell (non nella pagina): quando si apre il box
// feedback compare una tela di disegno sopra la barra. Disegnarci sopra deve:
//   - far comparire nel box (pagina) il bottone "Cancella disegno" (perché ora
//     c'è qualcosa da cancellare, anche se si è disegnato SOLO sulla barra);
//   - essere cancellabile dallo stesso bottone (un solo "Cancella" pulisce tutto).
//
// Asserisce IL SUCCESSO: il disegno sulla barra è davvero possibile e il box lo
// "vede" e lo gestisce, non solo l'assenza di un errore.

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

test('aprendo il box compare la tela sulla barra in alto della shell', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  // Prima dell'apertura la tela della barra è nascosta.
  await expect(shell.locator('#feedback-draw')).toHaveCount(1);
  expect(await shell.locator('#feedback-draw').isHidden()).toBe(true);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Entrando in modalità annotazione, la tela sopra la barra diventa visibile.
  await expect(shell.locator('#feedback-draw')).toBeVisible({ timeout: 4_000 });

  // Chiudendo il box, la tela torna nascosta.
  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
  await expect(shell.locator('#feedback-draw')).toBeHidden({ timeout: 4_000 });
});

test('disegnare sulla barra in alto fa comparire "Cancella disegno" nel box; cancellarlo pulisce tutto', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await expect(shell.locator('#feedback-draw')).toBeVisible({ timeout: 4_000 });

  const clear = page.locator('.sn-fb-clear');
  await expect(clear).toBeHidden();

  // Disegna un tratto SULLA BARRA IN ALTO (shell), in alto a sinistra dove c'è
  // la tela. (y piccolo = dentro l'altezza della barra.)
  const box = await shell.locator('#feedback-draw').boundingBox();
  const y = Math.min(15, (box?.height || 40) / 2);
  await shell.mouse.move(160, y);
  await shell.mouse.down();
  await shell.mouse.move(280, y + 2, { steps: 6 });
  await shell.mouse.move(360, y, { steps: 6 });
  await shell.mouse.up();

  // Il box (pagina) "vede" il disegno sulla barra → mostra "Cancella disegno".
  await expect(clear).toBeVisible({ timeout: 4_000 });

  // Un solo "Cancella disegno" pulisce anche la barra → il bottone si rinasconde.
  await clear.click();
  await expect(clear).toBeHidden({ timeout: 4_000 });

  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
});
