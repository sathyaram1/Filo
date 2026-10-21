// Test per i 3 fix di feedback alpha:
//   1) la textarea della chat newtab si svuota subito al click su Invia,
//      non solo dopo la risposta del modello;
//   2) i bottoni avanti/indietro (da #871 nella barra laterale) diventano
//      disabilitati quando la cronologia non lo consente;
//   3) durante la selezione dell'area screenshot il cursore viene reso
//      sempre visibile (custom SVG ad alto contrasto sopra la maschera).

import { test, expect } from './fixtures/electron.mjs';
import { iconaDellaBarra } from './helpers/barra.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
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

test('barra: back/forward disabilitati quando la history non lo consente', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Tab appena aperto: niente history → back e forward devono essere "grigi".
  // NB: spenti con aria-disabled, non con l'attributo `disabled` nativo, così
  // l'icona resta trascinabile per riordinarla (feedback yqgFIs).
  const back = await iconaDellaBarra(app, 'back');
  const fwd = await iconaDellaBarra(app, 'forward');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(fwd).toHaveAttribute('aria-disabled', 'true');

  // Naviga a B: ora è possibile tornare indietro.
  await page.goto(testServer.html(HTML_B));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await expect(await iconaDellaBarra(app, 'back')).toHaveAttribute('aria-disabled', 'false');
  // Da B non posso ancora andare avanti.
  await expect(await iconaDellaBarra(app, 'forward')).toHaveAttribute('aria-disabled', 'true');
});

test('barra: back/forward disabilitati sono visibilmente grigi (opacity ridotta)', async ({ app, openTab, testServer }) => {
  // I bottoni back/forward disabilitati devono apparire sbiaditi (opacity < 1),
  // non solo testualmente "muted". Senza questa regola l'utente non capisce
  // a colpo d'occhio che il bottone non è cliccabile.
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const back = await iconaDellaBarra(app, 'back');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  const opacity = await back.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(opacity).toBeLessThan(1);
});

test('screenshot area: l\'overlay imposta un cursore custom visibile su tutti i quadranti', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><html><body style="height:600px"><h1>Test</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Lancio il flusso reale: «Altro…» della barra e clic su "screenshotCrop".
  // capturePage in test può restituire un'immagine vuota, ma il flusso
  // arriva comunque a costruire l'overlay (l'immagine vuota carica e
  // selectScreenRegion appende l'overlay).
  await (await iconaDellaBarra(app, 'screenshotCrop')).click();

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
