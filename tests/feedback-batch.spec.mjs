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

async function openOverflowGrid(page, selector = 'h1') {
  await page.locator(selector).click({ button: 'right' });
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

  // Tab appena aperto: niente history → back e forward devono essere "grigi".
  // NB: la disabilitazione è via classe (sn-menu-btn-disabled), non attributo
  // `disabled` nativo, così l'icona resta trascinabile per riordinarla
  // (feedback yqgFIs). Lo stato grigio si verifica sulla classe, non su
  // toBeDisabled().
  let grid = await openOverflowGrid(page);
  const back1 = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]');
  const fwd1 = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]');
  await expect(back1).toHaveClass(/sn-menu-btn-disabled/);
  await expect(fwd1).toHaveClass(/sn-menu-btn-disabled/);
  // Chiudo il menu prima di navigare.
  await page.keyboard.press('Escape');

  // Naviga a B: ora è possibile tornare indietro.
  await page.goto(testServer.html(HTML_B));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  grid = await openOverflowGrid(page);
  await expect(grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]')).not.toHaveClass(/sn-menu-btn-disabled/);
  // Da B non posso ancora andare avanti.
  await expect(grid.locator('.sn-menu-icon-btn[data-sn-icon-id="forward"]')).toHaveClass(/sn-menu-btn-disabled/);
});

test('menu: back/forward disabilitati sono visibilmente grigi (opacity ridotta)', async ({ openTab, testServer }) => {
  // In parità con .nav-btn:disabled della shell, i bottoni back/forward del
  // menu tasto-destro disabilitati devono apparire sbiaditi (opacity < 1),
  // non solo testualmente "muted". Senza questa regola l'utente non capisce
  // a colpo d'occhio che il bottone non è cliccabile.
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const grid = await openOverflowGrid(page);
  const back = grid.locator('.sn-menu-icon-btn[data-sn-icon-id="back"]');
  await expect(back).toBeDisabled();
  const opacity = await back.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(opacity).toBeLessThan(1);
});

test('screenshot area: l\'overlay imposta un cursore custom visibile su tutti i quadranti', async ({ openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><html><body style="height:600px"><h1>Test</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Lancio il flusso reale: apro overflow e clicco "screenshotCrop".
  // capturePage in test può restituire un'immagine vuota, ma il flusso
  // arriva comunque a costruire l'overlay (l'immagine vuota carica e
  // selectScreenRegion appende l'overlay).
  const grid = await openOverflowGrid(page);
  await grid.locator('.sn-menu-icon-btn[data-sn-icon-id="screenshotCrop"]').click();

  const overlay = page.locator('.sn-region-overlay');
  await expect(overlay).toBeVisible({ timeout: 8000 });

  // Il cursore custom deve essere impostato sia sull'overlay sia su tutti i
  // figli "maschera" (è il punto del feedback: durante il drag il cursore
  // passa sopra le maschere e non deve sparire).
  const overlayCursor = await overlay.evaluate((el) => el.style.cursor || '');
  expect(overlayCursor).toMatch(/url\("?data:image\/svg/);

  const childCursors = await overlay.evaluate((el) => {
    return Array.from(el.children).map((c) => c.style.cursor || '');
  });
  expect(childCursors.length).toBeGreaterThan(0);
  for (const c of childCursors) {
    expect(c).toMatch(/url\("?data:image\/svg/);
  }

  // Esc chiude l'overlay (pulizia).
  await page.keyboard.press('Escape');
});
