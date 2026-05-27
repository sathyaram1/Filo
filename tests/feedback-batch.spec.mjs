// Test per i 3 fix di feedback alpha:
//   1) la textarea della chat newtab si svuota subito al click su Invia,
//      non solo dopo la risposta del modello;
//   2) nel menu tasto-destro i bottoni avanti/indietro diventano disabilitati
//      quando la cronologia non lo consente, in parità con i tasti analoghi
//      della barra in alto;
//   3) durante la selezione dell'area screenshot il cursore viene reso
//      sempre visibile (custom SVG ad alto contrasto sopra la maschera).

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function openOverflowGrid(page) {
  await page.locator('body').click({ button: 'right', position: { x: 50, y: 50 } });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const overflow = menu.locator('.sn-menu-row-overflow').first();
  await overflow.hover();
  const grid = page.locator('.sn-menu-icon-grid');
  await expect(grid).toBeVisible({ timeout: 2000 });
  return grid;
}

test('newtab: l\'input si svuota subito al submit (non aspetta la risposta)', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();

  // Scrivo qualcosa e premo invio. Il backend FILO_CHAT può anche non
  // rispondere subito (in test non c'è API key) — l'input deve comunque
  // diventare vuoto in modo sincrono al submit.
  await page.locator('#input').fill('ciao filo');
  expect(await page.locator('#input').inputValue()).toBe('ciao filo');

  await page.locator('#sendBtn').click();

  // Anche se la chiamata è ancora in flight (bolla "Filo sta pensando…"),
  // l'input deve essere già vuoto. Aspetto un brevissimo tick per dare
  // tempo al microtask di girare, ma niente di simile a un round-trip.
  await expect(page.locator('#input')).toHaveValue('', { timeout: 500 });

  // La bolla utente appare (conferma che il submit è andato a buon fine).
  await expect(page.locator('.dash-bubble-user').first()).toHaveText('ciao filo', { timeout: 2_000 });
});

const HTML_A = '<!doctype html><html><body><h1>A</h1></body></html>';
const HTML_B = '<!doctype html><html><body><h1>B</h1></body></html>';

test('menu: back/forward disabilitati quando la history non lo consente', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Tab appena aperto: niente history → back e forward devono essere disabilitati.
  let grid = await openOverflowGrid(page);
  const back1 = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]');
  const fwd1 = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]');
  await expect(back1).toBeDisabled();
  await expect(fwd1).toBeDisabled();
  // Chiudo il menu prima di navigare.
  await page.keyboard.press('Escape');

  // Naviga a B: ora è possibile tornare indietro.
  await page.goto(testServer.html(HTML_B));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  grid = await openOverflowGrid(page);
  await expect(grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]')).toBeEnabled();
  // Da B non posso ancora andare avanti.
  await expect(grid.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]')).toBeDisabled();
});

test('screenshot area: l\'overlay imposta un cursore custom visibile su tutti i quadranti', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><html><body><h1>Test</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Apro il menu, vado in overflow e clicco "Ritaglia". Mock di
  // CAPTURE_VISIBLE_TAB per non dover catturare davvero il frame.
  await page.evaluate(() => {
    const origSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === 'capture_visible_tab') {
        return Promise.resolve({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==' });
      }
      return origSend(msg, ...rest);
    };
  });

  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="screenshotCrop"]').click();

  const overlay = page.locator('.sn-region-overlay');
  await expect(overlay).toBeVisible({ timeout: 5000 });

  // Il cursore custom deve essere impostato sia sull'overlay sia su tutti i
  // figli "maschera" (è il punto del feedback: durante il drag il cursore
  // passa sopra le maschere e non deve sparire).
  const overlayCursor = await overlay.evaluate((el) => el.style.cursor || '');
  expect(overlayCursor).toMatch(/url\("data:image\/svg/);

  const childCursors = await overlay.evaluate((el) => {
    return Array.from(el.children).map((c) => c.style.cursor || '');
  });
  expect(childCursors.length).toBeGreaterThan(0);
  for (const c of childCursors) {
    expect(c).toMatch(/url\("data:image\/svg/);
  }

  // Esc chiude l'overlay (pulizia).
  await page.keyboard.press('Escape');
});
