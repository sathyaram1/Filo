// Il menu App (launcher nella shell) è reso da src/main/popup-menu.js in una
// BrowserWindow a parte: ogni voce mostra la sua icona SOLO se il nome icona
// esiste nel registro ICON_PATHS di quel file. "Mazzi"/"Deck builder MTG"
// (icona `decks`) e "Bacheca" (icona `board`) comparivano SENZA icona perché
// quei nomi mancavano dal registro del menu — feedback #292. Questo spec apre il
// vero menu App e verifica che ogni voce abbia la sua icona.

import { test, expect } from './fixtures/electron.mjs';

async function openLauncherPopup(shell, app) {
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('data:text/html'));
    if (win) {
      await win.waitForSelector('.item, .row', { timeout: 2000 }).catch(() => {});
      return win;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('popup del menu App non aperto');
}

test('nel menu App ogni voce con icona mostra la sua icona SVG', async ({ shell, app }) => {
  const popup = await openLauncherPopup(shell, app);

  // Le voci del launcher che devono avere un'icona (le due nel mirino del
  // feedback + le altre come controllo che nessuna sia rimasta muta).
  for (const label of ['Editor', 'Deck builder MTG', 'Feedback', 'Bacheca', 'Gestione']) {
    const item = popup.locator('.item', { hasText: label });
    await expect(item, `voce "${label}" assente nel menu App`).toBeVisible();
    await expect(
      item.locator('.ico svg'),
      `la voce "${label}" del menu App è senza icona`,
    ).toHaveCount(1);
  }

  // La rinomina richiesta: "Mazzi" non compare più, "Deck builder MTG" sì.
  await expect(popup.locator('.item', { hasText: 'Deck builder MTG' })).toBeVisible();
  await expect(popup.getByText('Mazzi', { exact: true })).toHaveCount(0);
});
