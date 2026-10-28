// Tre fix di feedback alpha: la casella della chat della nuova scheda si svuota al clic su Invia, non alla risposta;
// Indietro e Avanti della barra laterale sono spenti, e si vede, quando la cronologia non porta da nessuna parte;
// mentre si sceglie l'area di uno screenshot il cursore si vede sempre, anche sopra la maschera.

import { test, expect } from './fixtures/electron.mjs';
import { barraPage, comandaBarra, pannelloFermo, premiNellaBarra } from './helpers/barra.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function barraAperta(app) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  return barra;
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

test('barra laterale: back/forward spenti quando la history non lo consente', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Scheda appena aperta, senza cronologia: tutti e due spenti.
  const barra = await barraAperta(app);
  const back = barra.locator('#nav .ico[data-id="back"]');
  const fwd = barra.locator('#nav .ico[data-id="forward"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect(fwd).toHaveAttribute('aria-disabled', 'true');
  await comandaBarra(app, 'chiudi');

  await page.goto(testServer.html(HTML_B));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  // Da B non si va ancora avanti.
  await expect(fwd).toHaveAttribute('aria-disabled', 'true');
});

test('barra laterale: back/forward spenti sono visibilmente grigi (opacity ridotta)', async ({ app, openTab, testServer }) => {
  // Sbiadito, non solo smorzato: a colpo d'occhio si capisce che non si clicca.
  const page = await openTab(testServer.html(HTML_A));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  const barra = await barraAperta(app);
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'true');
  await expect.poll(() => back.evaluate((el) => parseFloat(getComputedStyle(el).opacity))).toBeLessThan(1);
  await expect.poll(() => barra.locator('#nav .ico[data-id="reload"]').evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
    { message: 'un\'icona accesa resta piena' }).toBe(1);
});

test('screenshot area: l\'overlay imposta un cursore custom visibile su tutti i quadranti', async ({ app, openTab, testServer }) => {
  const page = await openTab(testServer.html('<!doctype html><html><body style="height:600px"><h1>Test</h1></body></html>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });

  // Il flusso vero, dalla barra: anche con un'immagine vuota da capturePage l'overlay si costruisce.
  await premiNellaBarra(app, 'screenshotCrop');

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
