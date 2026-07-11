// Feedback #274: «Salvare un'immagine da un sito la fa sparire: la tab naviga
// sull'immagine invece di scaricarla». Chromium onora l'attributo `download`
// di un <a> lato pagina SOLO per URL same-origin/blob:/data:: per un'immagine
// ospitata su un ALTRO dominio (la stragrande maggioranza) lo ignorava e la
// scheda navigava sull'URL dell'immagine senza scaricare nulla. Ora il
// salvataggio passa dal main process (session download + will-download), che
// scarica a prescindere dall'origine.
//
// Il test riproduce ESATTAMENTE lo scenario del feedback: pagina su un server,
// immagine su un SECONDO server (porta diversa ⇒ origine diversa) e flusso
// utente reale (tasto destro sull'immagine → "Salva immagine come…").
// Asserisce il SUCCESSO: il file finisce su disco coi byte giusti E la scheda
// resta sulla pagina. Senza il fix: nessun file e la tab naviga → rosso.
// (In test FILO_DOWNLOAD_DIR salva direttamente senza dialogo nativo, vedi
// fixtures/electron.mjs.)

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// PNG 1×1 valido.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('"Salva immagine come…" su immagine cross-origin scarica il file senza far navigare la scheda', async ({ app, openTab, testServer }) => {
  // Server dedicato all'immagine: porta diversa dal testServer ⇒ altra origine.
  const imgServer = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
    res.end(PNG);
  });
  await new Promise((r) => imgServer.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${imgServer.address().port}/cat.png`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Un articolo qualsiasi</h1>
      <img id="pic" src="${imgUrl}" width="64" height="64">
    </body></html>`);
    const pageUrl = page.url();
    await page.waitForFunction(() => {
      const i = document.getElementById('pic');
      return i && i.complete && i.naturalWidth > 0;
    });

    // Flusso utente reale: tasto destro sull'immagine → voce del menu Filo.
    await page.locator('#pic').click({ button: 'right' });
    const item = page.locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(item).toBeVisible();
    await item.click();

    // SUCCESSO = il file è su disco, con i byte serviti dal server.
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('cat.png');
    expect(readFileSync(join(dir, 'cat.png')).equals(PNG)).toBe(true);

    // …la scheda NON è navigata sull'URL dell'immagine (il bug del feedback)…
    expect(page.url()).toBe(pageUrl);
    await expect(page.locator('#pic')).toBeVisible();

    // …e l'utente riceve la conferma visiva.
    await expect(page.locator('.sn-toast')).toContainText('Immagine salvata');
  } finally {
    try { imgServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => imgServer.close(r));
  }
});
