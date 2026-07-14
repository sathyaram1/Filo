// SICUREZZA: trascinare (drag & drop) un file nel box "Invia feedback" deve
// applicare la STESSA whitelist di tipi del pulsante "Allega". Prima del fix il
// drop accettava qualsiasi tipo — .html incluso — creando un vettore XSS/
// phishing (l'HTML, aperto dal link dell'allegato, gira nel dominio di Google
// Storage).
//
// Asserisce IL SUCCESSO del comportamento voluto:
//   - il drop di un .html (text/html) viene RIFIUTATO: nessuna pillola, compare
//     il messaggio di tipo non supportato;
//   - il drop di un .txt (tipo ammesso) viene ACCETTATO: compare la pillola.
// Se si rimuovesse il gate, il primo assert (0 pillole per l'.html) diventa rosso.

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

// Simula un drop reale sul modale con un file del tipo/nome dati.
async function dropFile(page, { name, type, content }) {
  await page.evaluate(({ name, type, content }) => {
    const modal = document.querySelector('.sn-fb-modal');
    const dt = new DataTransfer();
    dt.items.add(new File([content], name, { type }));
    modal.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { name, type, content });
}

test('drop di un .html viene rifiutato; drop di un .txt viene accettato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // 1) .html malevolo → NON deve essere accettato.
  await dropFile(page, {
    name: 'innocuo.html',
    type: 'text/html',
    content: '<script>alert(1)</script>',
  });
  // Nessuna pillola e nessuna anteprima: il file è stato scartato.
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(0);
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(0);
  // Messaggio di rifiuto visibile all'utente.
  await expect(page.locator('.sn-fb-status')).toContainText(/non supportato/i);

  // 2) .txt (tipo ammesso) → deve comparire come pillola allegato.
  await dropFile(page, {
    name: 'note.txt',
    type: 'text/plain',
    content: 'ciao filo',
  });
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText('note.txt');
});

test('anche un .svg (immagine attiva) trascinato viene rifiutato', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  await dropFile(page, {
    name: 'logo.svg',
    type: 'image/svg+xml',
    content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  });
  // L'SVG non deve entrare né tra le immagini né tra gli allegati.
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(0);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(0);
  await expect(page.locator('.sn-fb-status')).toContainText(/non supportato/i);
});
