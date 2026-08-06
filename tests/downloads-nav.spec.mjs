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

    // 4) SOPRAVVIVE AL RIAVVIO: la voce è scritta su disco (storage.json, che è
    //    ciò che l'app rilegge all'avvio). Verifica deterministica della
    //    persistenza senza dover rilanciare l'app.
    const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
    const storageFile = join(userData, 'storage.json');
    await expect.poll(() => {
      try {
        const data = JSON.parse(readFileSync(storageFile, 'utf8'));
        const arr = data.downloads || [];
        const e = arr.find((it) => it.filename === 'report.pdf');
        return e ? e.state : null;
      } catch (_) { return null; }
    }, { timeout: 8000 }).toBe('completed');
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('un download che si interrompe a metà viene segnalato (toast d\'errore + cronologia "interrotto")', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
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
    // La finestra di grazia concessa alla ripresa automatica di Chromium
    // (services/downloads.js) è di 20s: l'attesa qui deve superarla.
    await expect(shell.locator('.shell-notif-msg')).toContainText('non riuscito', { timeout: 45000 });

    // …e la cronologia lo segna "interrotto" (non "completato", non sparito).
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'grande.zip');
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('interrupted');
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('un server LENTO ma sano non viene scambiato per un guasto: il file arriva lo stesso', async ({ app, shell, openTab, testServer }) => {
  // Regressione: l'argine anti-silenzio non deve uccidere uno scaricamento solo
  // perché il trasferimento si ferma qualche secondo — capita di continuo con
  // rete congestionata, connessione mobile o file che il sito deve generare.
  // Qui il server è PERFETTAMENTE SANO: manda un pezzo, si prende 9 secondi di
  // pausa, poi conclude. Il file DEVE arrivare e la voce DEVE essere completata.
  test.setTimeout(120_000);
  const BODY = Buffer.alloc(200 * 1024, 7);
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(BODY.length),
      'Content-Disposition': 'attachment; filename="lento.bin"',
    });
    res.write(BODY.subarray(0, 64 * 1024));
    setTimeout(() => res.end(BODY.subarray(64 * 1024)), 9000);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/lento.bin`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Server lento</h1>
      <a id="dl" href="${fileUrl}">Scarica</a>
    </body></html>`);
    await page.locator('#dl').click();

    // SUCCESSO: la voce arriva a "completato" (non "interrotto") …
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const e = ((r && r.items) || []).find((it) => it.filename === 'lento.bin');
      return e ? e.state : null;
    }, { timeout: 60000 }).toBe('completed');

    // … e il file è davvero su disco, INTERO.
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(readFileSync(join(dir, 'lento.bin')).equals(BODY)).toBe(true);

    // Nessun falso allarme: il toast è quello di conferma, non di errore.
    const toasts = await shell.evaluate(() => Array.from(document.querySelectorAll('.shell-notif-msg')).map((n) => n.textContent || ''));
    expect(toasts.join('|')).not.toMatch(/non riuscit/i);
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});

test('una pagina web esterna non può leggere né comandare gli scaricamenti', async ({ app, shell, openTab, testServer }) => {
  // Gli scaricamenti sono UI di Filo: la cronologia espone i nomi dei file, gli
  // indirizzi di provenienza e il percorso ASSOLUTO su disco (che contiene lo
  // username), e i comandi possono far APRIRE un file al sistema operativo.
  // Nessun sito visitato deve poterci arrivare, come già per chiavi e settings.
  const fileServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': FILE.length,
      'Content-Disposition': 'attachment; filename="riservato.pdf"',
    });
    res.end(FILE);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileUrl = `http://127.0.0.1:${fileServer.address().port}/riservato.pdf`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body>
      <a id="dl" href="${fileUrl}">Scarica</a></body></html>`);
    await page.locator('#dl').click();
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return ((r && r.items) || []).length;
    }, { timeout: 15000 }).toBeGreaterThan(0);

    const id = (await shell.evaluate(() => window.filoShell.downloads.list())).items[0].id;
    const fromWeb = (msg) => app.evaluate((_e, m) => globalThis.SN_HANDLE_MESSAGE(m, {
      tab: { id: 99, url: 'http://sito-ostile.example/' }, url: 'http://sito-ostile.example/',
    }), msg);

    // Lettura della cronologia: negata, e senza far trapelare nulla.
    const list = await fromWeb({ type: 'downloads_list' });
    expect(list.ok).toBe(false);
    expect(list.error).toBe('forbidden');
    expect(JSON.stringify(list)).not.toContain('riservato.pdf');

    // Comandi: tutti negati (aprire un file scaricato = eseguirlo, su Windows).
    for (const type of ['download_open_file', 'download_open_folder', 'download_remove',
      'download_cancel', 'download_pause', 'download_resume', 'downloads_clear']) {
      const r = await fromWeb({ type, id });
      expect(r.error, `${type} accessibile da una pagina web`).toBe('forbidden');
    }

    // …mentre la shell e le pagine interne continuano a funzionare.
    const ok = await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: 'downloads_list' }, {
      tab: { id: 1, url: 'filo://newtab/' }, url: 'filo://newtab/',
    }));
    expect(ok.ok).toBe(true);
    expect(ok.items.length).toBeGreaterThan(0);
  } finally {
    try { fileServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => fileServer.close(r));
  }
});
