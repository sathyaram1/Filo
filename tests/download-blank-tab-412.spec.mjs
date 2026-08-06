// #412 — Un link "Scarica" con target=_blank che il server serve come allegato
// (Content-Disposition:attachment) apre una nuova scheda che si trasforma subito
// in scaricamento: nessuna pagina si committa mai e la scheda restava a
// about:blank — bianca, titolo "Nuova scheda", ATTIVA — che l'utente doveva
// chiudere a mano, senza alcun segno del download.
//
// SUCCESSO del fix (asserito qui, non l'assenza di un errore):
//   1) il file arriva davvero (il download parte e va a "completato");
//   2) NON resta alcuna scheda vuota: la barra torna al numero di schede di
//      prima del clic e il fuoco torna alla scheda di PARTENZA.
// Caso di controllo: lo STESSO link target=_blank verso una pagina HTML normale
// deve invece aprire e MANTENERE la nuova scheda col suo contenuto (il fix non
// deve chiudere le schede legittime).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const FILE = Buffer.from('%PDF-1.4\n% finto pdf #412\n' + 'x'.repeat(2048));

test('link "Scarica" target=_blank che avvia un download: nessuna scheda vuota residua, fuoco alla scheda di partenza', async ({ app, shell, openTab, testServer }) => {
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="scarica412.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/scarica412.pdf`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Download in nuova scheda</h1>
      <a id="dl" href="${fileUrl}" target="_blank" rel="noopener">Scarica (nuova scheda)</a>
    </body></html>`);

    // Stato di partenza: la scheda della pagina è quella attiva.
    const before = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    const startTabId = before.activeId;
    const baselineCount = before.tabs.length;
    expect(startTabId).toBeTruthy();

    // Flusso utente reale: clic sul link "Scarica" che apre in una nuova scheda.
    await page.locator('#dl').click();

    // 1) Il download parte davvero e arriva a "completato" + il file è su disco.
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'scarica412.pdf');
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('completed');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(existsSync(dir) ? readdirSync(dir) : []).toContain('scarica412.pdf');

    // 2) Nessuna scheda vuota residua: la barra torna al conteggio di prima…
    await expect.poll(async () => {
      const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
      return s.tabs.length;
    }, { timeout: 10000 }).toBe(baselineCount);

    // …e il fuoco è tornato alla scheda di PARTENZA (non a una scheda bianca).
    const after = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    expect(after.activeId).toBe(startTabId);
    // Nessuna scheda "Nuova scheda" con indirizzo vuoto lasciata in giro.
    const orphan = after.tabs.find((t) => !t.url || t.title === 'Nuova scheda' && !/^https?:/i.test(t.url || ''));
    expect(orphan, 'una scheda vuota è rimasta aperta dopo il download').toBeFalsy();
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('caso di controllo: link target=_blank verso una pagina normale apre e MANTIENE la nuova scheda', async ({ shell, openTab, testServer }) => {
  // La destinazione è una pagina HTML vera: la nuova scheda deve restare aperta
  // con il suo contenuto. Il fix del #412 non deve chiudere le schede legittime.
  const destUrl = testServer.html(`<!doctype html><html><head><title>Pagina di destinazione 412</title></head>
    <body><h1 id="ok">Contenuto reale</h1></body></html>`);

  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <h1>Apri pagina in nuova scheda</h1>
    <a id="go" href="${destUrl}" target="_blank" rel="noopener">Apri (nuova scheda)</a>
  </body></html>`);

  const before = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const baselineCount = before.tabs.length;

  await page.locator('#go').click();

  // La nuova scheda si apre e RESTA: il conteggio cresce di 1 e la scheda mostra
  // l'URL della pagina di destinazione (non è stata chiusa come contenitore vuoto).
  await expect.poll(async () => {
    const s = await shell.evaluate(() => window.filoShell.tabs.snapshot());
    return s.tabs.length;
  }, { timeout: 10000 }).toBe(baselineCount + 1);

  const after = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const opened = after.tabs.find((t) => (t.url || '').startsWith(destUrl));
  expect(opened, 'la scheda con la pagina di destinazione dovrebbe essere aperta').toBeTruthy();
});
