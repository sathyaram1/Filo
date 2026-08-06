// #410.1 — Scaricamenti "nativi" della navigazione: cliccando un link a un file
// (che il server serve come allegato) Filo deve intercettare il download,
// mostrarne l'avanzamento nella barra in alto, scrivere il file su disco,
// avvisare a fine scaricamento e registrarlo in una cronologia persistente.
//
// I test asseriscono il SUCCESSO (il file arriva + la cronologia segna
// "completato" + compare l'indicatore e il toast di conferma), non l'assenza di
// un errore. Senza l'intercettazione (il fix): nessun file gestito, nessuna voce
// di cronologia → rosso.
//
// In test FILO_DOWNLOAD_DIR (fixtures/electron.mjs) fa salvare direttamente nella
// cartella isolata, senza il dialogo nativo (impossibile da automatizzare).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Un finto "PDF": basta che sia un file con byte noti servito come allegato.
const FILE = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));

test('cliccando un link a un file, Filo lo scarica, lo registra come "completato" e avvisa', async ({ app, shell, openTab, testServer }) => {
  // Server del file: risponde con Content-Disposition:attachment ⇒ il browser
  // avvia un download invece di navigare. Porta diversa dal testServer.
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/report.pdf`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Pagina con un allegato</h1>
      <a id="dl" href="${fileUrl}">Scarica il report</a>
    </body></html>`);

    // Flusso utente reale: clic sul link al file.
    await page.locator('#dl').click();

    // 1) SUCCESSO su disco: il file arriva con i byte serviti dal server.
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(dir).toBeTruthy();
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('report.pdf');
    expect(readFileSync(join(dir, 'report.pdf')).equals(FILE)).toBe(true);

    // 2) SUCCESSO nella cronologia: una voce "completato" per quel file, con
    //    dimensione e percorso. È ciò che la pagina elenco (#410.3) leggerà.
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'report.pdf');
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('completed');
    const list = (await shell.evaluate(() => window.filoShell.downloads.list())).items;
    const entry = list.find((it) => it.filename === 'report.pdf');
    expect(entry.totalBytes).toBe(FILE.length);
    expect(entry.savePath).toContain('report.pdf');

    // 3) L'utente lo vede: compare l'indicatore nella barra e il toast di conferma
    //    con le azioni "Apri file"/"Apri cartella".
    await expect(shell.locator('#dl-indicator')).toBeVisible();
    await expect(shell.locator('.shell-notif-msg')).toContainText('Scaricato', { timeout: 8000 });
    await expect(shell.locator('.shell-notif-action', { hasText: 'Apri file' })).toBeVisible();
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('un download che si interrompe a metà viene segnalato (toast d\'errore + cronologia "interrotto")', async ({ app, shell, openTab, testServer }) => {
  // Il server dichiara un file grande, manda solo una parte e TRONCA la
  // connessione: il download si interrompe. Niente silenzio.
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': 5_000_000,
      'Content-Disposition': 'attachment; filename="grande.zip"',
    });
    res.write(Buffer.alloc(16_384));
    setTimeout(() => { try { res.destroy(); } catch (_) {} }, 50);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/grande.zip`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Server inaffidabile</h1>
      <a id="dl" href="${fileUrl}">Scarica</a>
    </body></html>`);

    await page.locator('#dl').click();

    // SUCCESSO del fix = il fallimento viene COMUNICATO: toast d'errore…
    await expect(shell.locator('.shell-notif-msg')).toContainText('non riuscito', { timeout: 20000 });

    // …e la cronologia lo segna "interrotto" (non "completato", non sparito).
    const entry = await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return ((r && r.items) || []).find((it) => it.filename === 'grande.zip') || null;
    }, { timeout: 15000 }).not.toBeNull();
    const list = (await shell.evaluate(() => window.filoShell.downloads.list())).items;
    const rec = list.find((it) => it.filename === 'grande.zip');
    expect(rec.state).toBe('interrupted');
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});
