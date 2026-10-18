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

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

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

// #1337: il sistema chiama certi documenti ammessi con un altro nome (Linux: .log `text/x-log`, .yaml `application/yaml`;
// Windows con Excel: .csv `application/vnd.ms-excel`). Si allegano lo stesso, e partono col tipo della lista.
test('un .log, un .yaml e un .csv col tipo dato dal sistema si allegano e partono col tipo della lista', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await app.evaluate(() => { globalThis.SN_FEEDBACK_OUTBOX._setAuto(false); });
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const dir = cartellaTemporanea('filo-tipi-');
  const log = join(dir, 'diario.log');
  const yaml = join(dir, 'config.yaml');
  writeFileSync(log, 'errore 42\n');
  writeFileSync(yaml, 'a: 1\n');
  const input = page.locator('.sn-fb-file');
  // Dal disco il tipo lo decide Chromium col sistema, come per chi sceglie il file nel selettore.
  await input.setInputFiles([log, yaml]);
  await input.setInputFiles({ name: 'misure.csv', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('a,b\n1,2\n') });
  await dropFile(page, { name: 'note.md', type: 'text/x-markdown', content: '# ciao' });

  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText(['diario.log', 'config.yaml', 'misure.csv', 'note.md']);
  await expect(page.locator('.sn-fb-status')).not.toContainText('non supportato');

  await page.locator('.sn-fb-text').fill('allego i file');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 4_000 });
  const tipi = await app.evaluate(() => globalThis.SN_FEEDBACK_OUTBOX._peek().flatMap((v) => (v.payload?.files || []).map((f) => [f.name, f.type])));
  expect(tipi).toEqual([
    ['diario.log', 'text/plain'], ['config.yaml', 'application/x-yaml'], ['misure.csv', 'text/csv'], ['note.md', 'text/markdown'],
  ]);
});

test('un .xls dichiarato come foglio di Excel resta rifiutato: l\'alias vale solo con l\'estensione della sua voce', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();
  await dropFile(page, { name: 'conti.xls', type: 'application/vnd.ms-excel', content: 'x' });
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(0);
  await expect(page.locator('.sn-fb-status')).toContainText(/non supportato/i);
});
