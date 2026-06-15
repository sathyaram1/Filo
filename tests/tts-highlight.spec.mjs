// Feedback: durante la lettura ad alta voce, la parola letta dev'essere
// EVIDENZIATA così l'utente può seguire.
//
// Asserisce IL SUCCESSO della feature (non l'assenza di errore): selezionando
// del testo e avviando "Leggi", sulla pagina compare un'evidenziazione (CSS
// Custom Highlight API, nome 'filo-reading') sulla PRIMA parola del testo
// selezionato.
//
// Perché la prima parola e subito: in CI headless non c'è motore vocale e non
// c'è chiave del modello, ma l'evidenziazione della parola iniziale viene
// impostata appena parte la lettura, indipendentemente dal motore — è quindi
// il segnale osservabile che la feature è cablata (tokenizzazione → Range →
// Highlight registrato).

import { test, expect } from './fixtures/electron.mjs';

const HTML = `<!doctype html><html><body style="padding:40px;font:18px sans-serif">
  <h1>Pagina di prova</h1>
  <p id="target">Questo è il testo che Filo deve leggere ad alta voce.</p>
</body></html>`;

test('avviando "Leggi", la prima parola viene evidenziata sulla pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);

  // Pre-condizione: l'API di evidenziazione esiste in questo runtime.
  const apiOk = await page.evaluate(() => typeof CSS !== 'undefined'
    && !!CSS.highlights && typeof window.Highlight === 'function');
  expect(apiOk, 'CSS Custom Highlight API disponibile in Electron 33').toBe(true);

  // Seleziona l'intero paragrafo.
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // Apre il menu Filo e clicca "Leggi".
  await page.locator('#target').click({ button: 'right' });
  const menu = page.locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const readItem = menu.locator('.sn-menu-label', { hasText: 'Leggi' }).first();
  await expect(readItem).toBeVisible();
  await readItem.click();

  // L'evidenziazione 'filo-reading' compare…
  await expect
    .poll(() => page.evaluate(() => (CSS.highlights ? CSS.highlights.has('filo-reading') : false)), { timeout: 4000 })
    .toBe(true);

  // …e copre la PRIMA parola del testo selezionato.
  const highlighted = await page.evaluate(() => {
    const h = CSS.highlights.get('filo-reading');
    if (!h) return '';
    const ranges = Array.from(h);
    return ranges[0] ? ranges[0].toString() : '';
  });
  expect(highlighted).toBe('Questo');

  // Lo stile dell'evidenziazione è stato iniettato (regola ::highlight).
  const hasStyle = await page.evaluate(() => !!document.getElementById('sn-read-style'));
  expect(hasStyle).toBe(true);
});
