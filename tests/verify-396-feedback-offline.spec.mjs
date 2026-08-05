// VERIFIER #396 — pagina gemella "Feedback alpha": davanti allo stesso guasto di
// rete deve mostrare la STESSA frase comprensibile (mai "Failed to fetch") + un
// tasto "Riprova", come la Bacheca. Test black-box del verificatore.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';

test('offline: Feedback alpha mostra una frase in italiano + Riprova, NON "Failed to fetch"', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Attendi che i moduli condivisi + il primo caricamento siano montati.
  await page.waitForFunction(() => window.SN_FEEDBACK && document.getElementById('refresh'), null, { timeout: 15_000 });

  // Simula la rete assente: la lista rigetta come fa il fetch del renderer
  // Chromium offline. Poi forza un ricaricamento con "Aggiorna".
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = () => Promise.reject(new TypeError('Failed to fetch'));
  });
  await page.locator('#refresh').click();

  // Compare la frase d'errore comprensibile.
  const errMsg = page.locator('.fb-load-error-msg');
  await expect(errMsg).toBeVisible({ timeout: 10_000 });
  const txt = (await errMsg.textContent() || '').trim();
  expect(txt.toLowerCase()).not.toContain('failed to fetch');
  expect(txt.toLowerCase()).toMatch(/connession|riprova|rete/);

  // Il tasto Riprova esiste e funziona: rete ripristinata → la lista carica.
  const retry = page.locator('.fb-load-retry');
  await expect(retry).toBeVisible();
  await page.evaluate(() => {
    window.SN_FEEDBACK.list = () => Promise.resolve([]);
  });
  await retry.click();
  // A rete tornata, l'errore sparisce (mostra lo stato vuoto normale della pagina).
  await expect(errMsg).toBeHidden({ timeout: 10_000 });
});
