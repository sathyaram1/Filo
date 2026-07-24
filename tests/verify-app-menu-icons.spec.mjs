// VERIFIER (feedback #292) — black-box: apro davvero il menu App (icona App in
// alto a destra) e verifico che OGNI voce mostri un'icona SVG, che la voce
// "Mazzi" sia stata rinominata in "Deck builder MTG" e che la Bacheca abbia la
// sua icona. Senza il fix (icone 'decks'/'board' assenti) queste voci restano
// mute → il test fallisce.

import { test, expect } from './fixtures/electron.mjs';

async function openAppMenu(app, shell) {
  // Il bottone App vive nella shell; anche se la barra è nascosta, un click JS
  // sul bottone innesca il popup nativo (BrowserWindow con data: URL).
  await shell.evaluate(() => document.getElementById('nav-apps')?.click());
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const w = app.windows().find((p) => p.url().startsWith('data:text/html'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error('menu App non aperto');
}

test('ogni voce del menu App mostra un\'icona; Mazzi rinominato in Deck builder MTG', async ({ app, shell }) => {
  const menu = await openAppMenu(app, shell);

  // Le voci cliccabili del menu sono i .item (button). Ne attendiamo la presenza.
  const items = menu.locator('.menu .item');
  await expect(items.first()).toBeVisible();

  const labels = await items.locator('.lbl').allInnerTexts();
  // Attese: Editor, Deck builder MTG, Feedback, Bacheca, Gestione
  expect(labels).toContain('Deck builder MTG');
  expect(labels).toContain('Bacheca');
  // La vecchia etichetta non deve più comparire come voce.
  expect(labels).not.toContain('Mazzi');

  // OGNI voce cliccabile deve avere un'icona SVG (il sintomo del feedback era
  // proprio Mazzi e Bacheca "mute"). Verifichiamo che il numero di item con
  // <svg> uguagli il numero totale di item.
  const total = await items.count();
  expect(total).toBeGreaterThanOrEqual(5);
  const withSvg = await menu.locator('.menu .item .ico svg').count();
  expect(withSvg, 'alcune voci del menu App non hanno icona').toBe(total);

  // Controllo mirato: la voce Bacheca ha davvero un\'icona a fianco.
  const bacheca = menu.locator('.menu .item', { hasText: 'Bacheca' });
  await expect(bacheca.locator('.ico svg')).toHaveCount(1);
  const deck = menu.locator('.menu .item', { hasText: 'Deck builder MTG' });
  await expect(deck.locator('.ico svg')).toHaveCount(1);

  // Traccia visiva ispezionabile.
  try { await menu.screenshot({ path: 'tests/.shots/verify-app-menu-292.png' }); } catch (_) {}
});
