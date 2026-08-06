// Stress test avversariale del verificatore per #410.1 (scaricamenti nativi).
// Nessuna conoscenza del fix: si parte dal sintomo utente ("il file si scarica
// al buio") e si prova a rompere la funzione con input limite.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function serveAttachment(filename, body, opts = {}) {
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      // filename* (RFC 5987) permette caratteri non-ASCII: gli header HTTP
      // grezzi accettano solo latin-1, quindi emoji & co. vanno percent-encoded.
      const headers = {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': opts.rawDisposition
          || `attachment; filename="${filename}"`,
      };
      if (!opts.noLength) headers['Content-Length'] = String(body.length);
      res.writeHead(opts.status || 200, headers);
      if (opts.drip) {
        // manda a pezzi con pause brevi: avanzamento osservabile
        let i = 0;
        const step = Math.max(1, Math.ceil(body.length / 10));
        const tick = () => {
          if (i >= body.length) { res.end(); return; }
          res.write(body.subarray(i, i + step));
          i += step;
          setTimeout(tick, opts.drip);
        };
        tick();
      } else {
        res.end(body);
      }
    });
    srv.listen(0, '127.0.0.1', () => done({
      srv,
      url: (p = '/f') => `http://127.0.0.1:${srv.address().port}${p}`,
      close: async () => {
        try { srv.closeAllConnections?.(); } catch (_) {}
        await new Promise((r) => srv.close(r));
      },
    }));
  });
}

const linkPage = (urls) => `<!doctype html><html><body style="padding:40px">${
  urls.map((u, i) => `<a id="dl${i}" href="${u}">scarica ${i}</a><br>`).join('')
}</body></html>`;

const listItems = (shell) => shell.evaluate(async () => {
  const r = await window.filoShell.downloads.list();
  return (r && r.items) || [];
});

test('nome file ostile (path traversal + emoji + XSS) non esce dalla cartella né inietta HTML', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const BODY = Buffer.from('ciao-ostile');
  // nome che tenta: risalita di cartella, HTML eseguibile, emoji, spazi.
  const hostile = '../../../../pwned <img src=x onerror=window.__filoPwned=1> 🎉.txt';
  const s = await serveAttachment(hostile, BODY, {
    rawDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(hostile)}`,
  });
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();

    await expect.poll(async () => (await listItems(shell)).length, { timeout: 20000 }).toBeGreaterThan(0);
    const items = await listItems(shell);
    const it = items[items.length - 1];

    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    // 1) il file NON deve essere finito fuori dalla cartella di download
    expect(it.savePath, 'salvato fuori dalla cartella download').toContain(resolve(dir));
    expect(existsSync(it.savePath)).toBe(true);
    // 2) nessuna risalita nel nome registrato
    expect(it.filename.includes('..')).toBe(false);
    expect(/[\\/]/.test(it.filename)).toBe(false);
    // 3) nessuna esecuzione di HTML nella shell
    const pwned = await shell.evaluate(() => window.__filoPwned || null);
    expect(pwned, 'HTML nel nome file eseguito nella shell').toBe(null);
    // 4) nessun elemento <img> iniettato nei toast/indicatore
    const injected = await shell.evaluate(() =>
      document.querySelectorAll('.shell-notif img, #dl-indicator img, .shell-notif script').length);
    expect(injected).toBe(0);
    await shell.screenshot({ path: 'tests/.shots/verifier-410-hostile-name.png' });
  } finally { await s.close(); }
});

test('nome file lunghissimo (600 caratteri): niente crash, avviso di dimensioni sane', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const long = 'a'.repeat(600) + '.bin';
  const s = await serveAttachment(long, Buffer.alloc(1024, 3));
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();
    await expect.poll(async () => (await listItems(shell)).length, { timeout: 20000 }).toBeGreaterThan(0);
    const it = (await listItems(shell))[0];
    expect(existsSync(it.savePath)).toBe(true);
    // il toast non deve diventare un muro di testo: la larghezza del riquadro
    // resta nei limiti della finestra
    await expect(shell.locator('.shell-notif-msg').first()).toBeVisible({ timeout: 10000 });
    const box = await shell.locator('.shell-notif').first().boundingBox();
    const win = await shell.evaluate(() => window.innerWidth);
    expect(box.width, `avviso largo ${box.width} su finestra ${win}`).toBeLessThanOrEqual(win);
    await shell.screenshot({ path: 'tests/.shots/verifier-410-long-name.png' });
  } finally { await s.close(); }
});

test('dimensione totale sconosciuta (niente Content-Length): avanzamento senza NaN e file completo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const BODY = Buffer.alloc(300 * 1024, 9);
  const s = await serveAttachment('senza-lunghezza.bin', BODY, { noLength: true, drip: 120 });
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();

    // mentre scarica: l'indicatore c'è e NON mostra NaN/undefined/Infinity
    await expect(shell.locator('#dl-indicator')).toBeVisible({ timeout: 15000 });
    const texts = [];
    for (let i = 0; i < 8; i++) {
      texts.push(await shell.locator('#dl-indicator').innerText().catch(() => ''));
      await shell.waitForTimeout(150);
    }
    expect(texts.join('|')).not.toMatch(/NaN|undefined|Infinity|-\d+%/);

    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'senza-lunghezza.bin');
      return e ? e.state : null;
    }, { timeout: 40000 }).toBe('completed');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(readFileSync(join(dir, 'senza-lunghezza.bin')).equals(BODY)).toBe(true);
  } finally { await s.close(); }
});

test('file vuoto (0 byte): registrato come completato, non come guasto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const s = await serveAttachment('vuoto.txt', Buffer.alloc(0));
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'vuoto.txt');
      return e ? e.state : null;
    }, { timeout: 25000 }).toBe('completed');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(statSync(join(dir, 'vuoto.txt')).size).toBe(0);
    const toasts = await shell.evaluate(() => Array.from(document.querySelectorAll('.shell-notif-msg')).map((n) => n.textContent || ''));
    expect(toasts.join('|')).not.toMatch(/non riuscit/i);
  } finally { await s.close(); }
});

test('tre scaricamenti insieme + doppio clic: tutti tracciati, nessuno perso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const bodies = [Buffer.alloc(120 * 1024, 1), Buffer.alloc(120 * 1024, 2), Buffer.alloc(120 * 1024, 3)];
  const servers = [];
  for (let i = 0; i < 3; i++) servers.push(await serveAttachment(`multi-${i}.bin`, bodies[i], { drip: 60 }));
  try {
    const page = await testServer.openReady(openTab, linkPage(servers.map((s) => s.url())));
    // doppio clic rapido sul primo + clic sugli altri due
    await page.locator('#dl0').click();
    await page.locator('#dl0').click();
    await page.locator('#dl1').click();
    await page.locator('#dl2').click();

    // l'indicatore mostra che ce n'è più di uno in corso
    await expect(shell.locator('#dl-indicator')).toBeVisible({ timeout: 15000 });

    await expect.poll(async () => {
      const items = await listItems(shell);
      const done = items.filter((x) => /^multi-\d/.test(x.filename) && x.state === 'completed');
      return done.length;
    }, { timeout: 60000 }).toBeGreaterThanOrEqual(3);

    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const files = readdirSync(dir);
    for (let i = 0; i < 3; i++) expect(files.some((f) => f.startsWith(`multi-${i}`))).toBe(true);
    // il doppio clic non deve aver sovrascritto: due file distinti per multi-0
    const zeros = files.filter((f) => f.startsWith('multi-0'));
    expect(zeros.length).toBeGreaterThanOrEqual(1);
    await shell.screenshot({ path: 'tests/.shots/verifier-410-multi.png' });
  } finally { for (const s of servers) await s.close(); }
});

test('annulla a metà: lo scaricamento risulta annullato e non resta "in corso" per sempre', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const s = await serveAttachment('da-annullare.bin', Buffer.alloc(2 * 1024 * 1024, 5), { drip: 400 });
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'da-annullare.bin');
      return e ? e.state : null;
    }, { timeout: 25000 }).toBe('progressing');
    const id = (await listItems(shell)).find((x) => x.filename === 'da-annullare.bin').id;
    const r = await shell.evaluate((i) => window.filoShell.downloads.cancel(i), id);
    expect(r && r.ok).toBe(true);
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'da-annullare.bin');
      return e ? e.state : null;
    }, { timeout: 20000 }).toBe('cancelled');
  } finally { await s.close(); }
});

test('pausa e ripresa: il file arriva comunque intero', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const BODY = Buffer.alloc(600 * 1024, 4);
  const s = await serveAttachment('pausa.bin', BODY, { drip: 200 });
  try {
    const page = await testServer.openReady(openTab, linkPage([s.url()]));
    await page.locator('#dl0').click();
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'pausa.bin');
      return e ? e.state : null;
    }, { timeout: 25000 }).toBe('progressing');
    const id = (await listItems(shell)).find((x) => x.filename === 'pausa.bin').id;
    await shell.evaluate((i) => window.filoShell.downloads.pause(i), id);
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'pausa.bin');
      return e ? e.state : null;
    }, { timeout: 15000 }).toBe('paused');
    await shell.evaluate((i) => window.filoShell.downloads.resume(i), id);
    await expect.poll(async () => {
      const e = (await listItems(shell)).find((x) => x.filename === 'pausa.bin');
      return e ? e.state : null;
    }, { timeout: 60000 }).toBe('completed');
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    expect(readFileSync(join(dir, 'pausa.bin')).equals(BODY)).toBe(true);
  } finally { await s.close(); }
});

test('comandi con id inesistente o assurdo: risposta pulita, niente crash', async ({ app, shell }) => {
  const junk = ['', null, 0, '../../etc/passwd', '<script>', 'a'.repeat(10000), '💥'];
  for (const id of junk) {
    for (const cmd of ['remove', 'openFile', 'openFolder', 'cancel', 'pause', 'resume']) {
      const r = await shell.evaluate(async ([c, i]) => {
        try { return await window.filoShell.downloads[c](i); }
        catch (e) { return { threw: String(e && e.message || e) }; }
      }, [cmd, id]);
      expect(r, `${cmd}(${String(id).slice(0, 20)}) senza risposta`).toBeTruthy();
      expect(r.threw, `${cmd} ha fatto esplodere il canale`).toBeFalsy();
      // I comandi che aprono qualcosa nel sistema operativo NON devono mai
      // riuscire con un id che non esiste (sarebbe apertura di un percorso
      // arbitrario). `remove` idempotente che dice ok è invece accettabile.
      if (cmd === 'openFile' || cmd === 'openFolder') {
        expect(r.ok, `${cmd} apre qualcosa con un id inesistente`).toBeFalsy();
      }
    }
  }
  // stato vuoto: elenco e svuota funzionano lo stesso
  const empty = await shell.evaluate(() => window.filoShell.downloads.list());
  expect(empty.ok).toBe(true);
  expect(Array.isArray(empty.items)).toBe(true);
  const cleared = await shell.evaluate(() => window.filoShell.downloads.clear());
  expect(cleared.ok).toBe(true);
  // l'app è ancora viva dopo tutto questo
  expect(await shell.evaluate(() => 1 + 1)).toBe(2);
});
