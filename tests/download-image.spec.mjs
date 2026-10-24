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
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { menuDi } from './helpers/menuContestuale.mjs';

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
    const item = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
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

test('"Salva immagine come…" funziona anche su siti con protezione hotlink (richiedono il Referer)', async ({ app, openTab, testServer }) => {
  // Server immagine con protezione hotlink: 403 a qualunque richiesta SENZA
  // Referer (la classe di siti su cui il primo fix falliva: l'immagine si vede
  // nella pagina — l'<img> manda il Referer — ma il download partiva anonimo).
  const seenReferers = [];
  const imgServer = createServer((req, res) => {
    const ref = String(req.headers.referer || '');
    seenReferers.push(ref);
    if (!ref.startsWith('http://127.0.0.1:')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('hotlink denied');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
    res.end(PNG);
  });
  await new Promise((r) => imgServer.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${imgServer.address().port}/protected.png`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Blog con CDN protetto</h1>
      <img id="pic" src="${imgUrl}" width="64" height="64">
    </body></html>`);
    const pageUrl = page.url();
    await page.waitForFunction(() => {
      const i = document.getElementById('pic');
      return i && i.complete && i.naturalWidth > 0;
    });

    await page.locator('#pic').click({ button: 'right' });
    const item = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(item).toBeVisible();
    await item.click();

    // SUCCESSO: il file arriva su disco nonostante la protezione hotlink…
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('protected.png');
    expect(readFileSync(join(dir, 'protected.png')).equals(PNG)).toBe(true);

    // …perché la richiesta di download ha presentato la provenienza (l'ultima
    // richiesta vista dal server NON era anonima)…
    expect(seenReferers[seenReferers.length - 1]).toMatch(/^http:\/\/127\.0\.0\.1:/);

    // …la scheda non è navigata e l'utente riceve la conferma.
    expect(page.url()).toBe(pageUrl);
    await expect(page.locator('.sn-toast')).toContainText('Immagine salvata');
  } finally {
    try { imgServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => imgServer.close(r));
  }
});

// #1510 — un nome col carattere che capovolge la lettura (U+202E) si mostra con l'estensione sbagliata: nel dialogo,
// nel file parziale e nella barra deve arrivare il nome vero. E il file salvato porta la marca d'origine del sistema.
test('«Salva immagine come» salva col nome vero, senza caratteri che capovolgono la lettura, e marca il file come arrivato da Internet', async ({ app, shell, openTab, testServer }) => {
  const imgServer = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': PNG.length,
      'Content-Disposition': "inline; filename*=UTF-8''ricordo%E2%80%AEgpj.png",
    });
    res.end(PNG);
  });
  await new Promise((r) => imgServer.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${imgServer.address().port}/foto`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Galleria</h1>
      <img id="pic" src="${imgUrl}" width="64" height="64">
    </body></html>`);
    const pageUrl = page.url();
    await page.waitForFunction(() => {
      const i = document.getElementById('pic');
      return i && i.complete && i.naturalWidth > 0;
    });

    await page.locator('#pic').click({ button: 'right' });
    const item = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(item).toBeVisible();
    await item.click();

    // In test il nome proposto al dialogo è il nome del file salvato.
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    await expect
      .poll(() => (existsSync(dir) ? readdirSync(dir) : []), { timeout: 15000 })
      .toContain('ricordogpj.png');
    const file = join(dir, 'ricordogpj.png');
    expect(readFileSync(file).equals(PNG)).toBe(true);
    expect(readdirSync(dir).filter((n) => /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(n))).toEqual([]);

    // La voce nella barra dice lo stesso nome del file su disco.
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      const v = ((r && r.items) || []).find((it) => it.url === imgUrl);
      return v && v.state === 'completed' ? { filename: v.filename, savePath: v.savePath } : null;
    }, { timeout: 10000 }).toEqual({ filename: 'ricordogpj.png', savePath: file });

    if (process.platform === 'win32') {
      const marca = readFileSync(`${file}:Zone.Identifier`, 'utf8');
      expect(marca).toContain('ZoneId=3');
      expect(marca).toContain(`HostUrl=${imgUrl}`);
      // L'immagine sta su un'altra origine: della pagina resta l'origine, come nel Referer.
      expect(marca).toContain(`ReferrerUrl=${new URL(pageUrl).origin}/\r\n`);
    } else if (process.platform === 'darwin') {
      expect(execFileSync('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], { encoding: 'utf8' })).toMatch(/^0081;[0-9a-f]+;Filo;/);
    } else {
      // Linux non ha una marca di sistema: accanto al file non deve nascere niente.
      expect(readdirSync(dir).filter((n) => n.includes('Zone.Identifier'))).toEqual([]);
    }
    await expect(page.locator('.sn-toast')).toContainText('Immagine salvata');
  } finally {
    try { imgServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => imgServer.close(r));
  }
});

test('download che si interrompe a metà → l\'utente riceve un messaggio d\'errore (niente silenzio)', async ({ app, openTab, testServer }) => {
  // Prima richiesta (l'<img> della pagina): PNG valido. Richieste successive
  // (il download e l'eventuale ripresa): il server dichiara un file grande,
  // manda solo una parte e TRONCA la connessione. Chromium lascia il download
  // in sospeso "riprendibile" senza mai concluderlo: prima del fix l'utente
  // non riceveva MAI alcun riscontro.
  let hits = 0;
  const imgServer = createServer((req, res) => {
    hits++;
    if (hits === 1) {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
        'Cache-Control': 'no-store', // il download NON deve servirsi dalla cache
      });
      res.end(PNG);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': 100000,
      'ETag': '"trunc-1"',
      'Accept-Ranges': 'bytes',
    });
    res.write(Buffer.alloc(10000));
    // Tronca a metà: connessione chiusa dal server, download interrotto.
    setTimeout(() => { try { res.destroy(); } catch (_) {} }, 50);
  });
  await new Promise((r) => imgServer.listen(0, '127.0.0.1', r));
  const imgUrl = `http://127.0.0.1:${imgServer.address().port}/huge.png`;

  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <h1>Server inaffidabile</h1>
      <img id="pic" src="${imgUrl}" width="64" height="64">
    </body></html>`);
    const pageUrl = page.url();
    await page.waitForFunction(() => {
      const i = document.getElementById('pic');
      return i && i.complete && i.naturalWidth > 0;
    });

    await page.locator('#pic').click({ button: 'right' });
    const item = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
    await expect(item).toBeVisible();
    await item.click();

    // SUCCESSO del fix = il fallimento viene COMUNICATO: toast d'errore entro
    // pochi secondi (prima: silenzio per sempre), scheda ancora sulla pagina.
    await expect(page.locator('.sn-toast')).toContainText('Non sono riuscito a salvare', { timeout: 25000 });
    expect(page.url()).toBe(pageUrl);

    // Il download è stato davvero tentato (oltre alla richiesta dell'<img>).
    expect(hits).toBeGreaterThanOrEqual(2);
  } finally {
    try { imgServer.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => imgServer.close(r));
  }
});
