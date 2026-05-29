// Feedback RW1T (dimensione del testo):
//   1. ingrandire il testo creava uno scroll nella home (newtab): il layout
//      `100vh` veniva magnificato da `zoom` oltre la viewport. Gli elementi
//      devono restare nella stessa posizione, senza scroll.
//   2. il cambio non si applicava alle tab già aperte ma dovrebbe: il canale
//      live era `chrome.storage.onChanged`, che NON viene propagato fra i
//      WebContentsView. Ora la home ascolta il broadcast `settings_updated`.

import { test, expect } from './fixtures/electron.mjs';

test('ingrandire il testo non crea scroll nella home (elementi nella stessa posizione)', async ({ openTab }) => {
  const dash = await openTab('filo://newtab/');
  await dash.waitForSelector('#dash', { timeout: 8000 });

  // Stato normale (100%): la home riempie la viewport senza traboccare.
  const overflowAt = (scale) => dash.evaluate((s) => {
    window.SN_PAGE_BOOTSTRAP.applyTextScale(s);
    const el = document.scrollingElement || document.documentElement;
    return {
      zoomVar: getComputedStyle(document.documentElement).getPropertyValue('--sn-zoom').trim(),
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    };
  }, scale);

  const base = await overflowAt(1);
  expect(base.scrollH).toBeLessThanOrEqual(base.clientH + 4);

  // Ingrandendo molto il testo NON deve comparire scroll verticale: la home
  // compensa il fattore di zoom. Prima del fix scrollH ≈ 1.5×clientH.
  const big = await overflowAt(1.5);
  expect(big.zoomVar).toBe('1.5');
  expect(big.scrollH, 'la home non deve traboccare/scrollare quando si ingrandisce il testo')
    .toBeLessThanOrEqual(big.clientH + 4);
});

test('cambiare la dimensione del testo si applica subito alle tab già aperte', async ({ openTab }) => {
  // Tab già aperta: la home.
  const dash = await openTab('filo://newtab/');
  await dash.waitForSelector('#dash', { timeout: 8000 });
  // Parte da 100% (nessuno zoom esplicito).
  const initialZoom = await dash.evaluate(() => document.documentElement.style.zoom);
  expect(initialZoom === '' || initialZoom === '1').toBeTruthy();

  // In un'altra tab cambio la dimensione del testo dalle Preferenze.
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#textScale', { timeout: 8000 });
  await prefs.selectOption('#textScale', '1.5');

  // La home già aperta deve aggiornarsi da sola via broadcast `settings_updated`.
  await expect
    .poll(() => dash.evaluate(() => document.documentElement.style.zoom), { timeout: 5000 })
    .toBe('1.5');
});
