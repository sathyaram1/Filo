// FEEDBACK alpha (p3): "rendi possibile allegare anche altri file oltre alle
// immagini nei feedback (pdf, txt, md, json...)".
//
// Il box feedback ora accetta allegati non-immagine: compaiono come "pillole"
// con il nome del file (rimovibili), mentre le immagini restano anteprime.
// Asserisce IL SUCCESSO della feature (il file viene acquisito e mostrato),
// non l'assenza di un errore.
//
// NB: l'upload effettivo su Firebase Storage (e la sua visualizzazione nella
// dashboard) non è verificabile in cloud (rete + storage.rules da deployare):
// qui verifichiamo il comportamento client che cattura il file nel payload.

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

test('si possono allegare file non-immagine (.txt/.json): pillole col nome, rimovibili', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // L'input file ora ammette anche i documenti, non solo image/*.
  const fileInput = page.locator('.sn-fb-file');
  await expect(fileInput).toHaveAttribute('accept', /application\/pdf/);

  await fileInput.setInputFiles([
    { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao filo') },
    { name: 'data.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') },
  ]);

  const chips = page.locator('.sn-fb-file-chip');
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0).locator('.sn-fb-file-name')).toHaveText('note.txt');
  await expect(chips.nth(1).locator('.sn-fb-file-name')).toHaveText('data.json');

  // I file finiscono nello stato che verrà inviato (niente anteprima immagine).
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(0);

  // La × rimuove la pillola corrispondente.
  await chips.nth(0).locator('.sn-fb-file-x').click();
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(1);
  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText('data.json');
});

test('le immagini restano anteprime, non pillole-file', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // PNG 1x1 valido.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );
  await page.locator('.sn-fb-file').setInputFiles([{ name: 'pic.png', mimeType: 'image/png', buffer: png }]);

  await expect(page.locator('.sn-fb-thumb img')).toHaveCount(1);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(0);
});
