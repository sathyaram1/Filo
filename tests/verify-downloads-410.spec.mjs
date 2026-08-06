// VERIFICA (verifier, #410.1) — black-box dal sintomo utente:
// "clicco un link a un file e non vedo nulla: nessuna barra, nessuna percentuale,
//  nessun avviso a fine o in caso di errore, e non resta traccia".
//
// Non guarda il diff: esercita l'app come farebbe l'utente.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test.setTimeout(90_000);

// Server che sa servire un vero allegato (il testServer del fixture serve solo HTML).
async function attachServer(routes) {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const h = routes[url];
    if (!h) { res.writeHead(404); res.end('nope'); return; }
    h(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

// Legge i toast REALI dal DOM della shell (non un hook: quello che vede l'utente).
const readToasts = (shell) => shell.evaluate(() => Array.from(document.querySelectorAll('.shell-notif')).map((c) => ({
  text: c.querySelector('.shell-notif-msg')?.textContent || '',
  actions: Array.from(c.querySelectorAll('.shell-notif-action')).map((b) => b.textContent),
})));

const htmlPage = (links) => `<!doctype html><meta charset="utf-8"><body>
${links.map((l, i) => `<a id="dl${i}" href="${l}">scarica ${i}</a><br>`).join('\n')}
</body>`;

async function dlDir(app) {
  return await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
}
async function userData(app) {
  return await app.evaluate(() => process.env.FILO_USER_DATA);
}

test('1) SUCCESSO: link a file → il file arriva, la barra avanza, toast con Apri file, cronologia persistita', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(900 * 1024, 0x41); // 900KB, abbastanza per vedere progresso
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(['/rapporto.zip'])); },
    '/rapporto.zip': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': String(BODY.length),
        'Content-Disposition': 'attachment; filename="rapporto.zip"',
      });
      // a fette, con ritardo, così l'avanzamento è osservabile
      let off = 0;
      const tick = () => {
        if (off >= BODY.length) { res.end(); return; }
        res.write(BODY.subarray(off, off + 64 * 1024));
        off += 64 * 1024;
        setTimeout(tick, 60);
      };
      tick();
    },
  });

  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl0');

    // (a) L'indicatore compare e la barra segue un progresso REALE (non 0, non 100 subito).
    await shell.waitForSelector('#dl-indicator:not([hidden])', { timeout: 15000 });
    const widths = new Set();
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const w = await shell.evaluate(() => document.getElementById('dl-ind-fill')?.style.width || '');
      if (w) widths.add(w);
      const done = await shell.evaluate(() => document.getElementById('dl-indicator')?.classList.contains('active') === false);
      if (done && widths.size > 1) break;
      await shell.waitForTimeout(120);
    }
    console.log('larghezze barra osservate:', [...widths].join(' '));
    expect([...widths].some((w) => w !== '0%' && w !== '100%'), `barra mai a un valore intermedio: ${[...widths]}`).toBeTruthy();

    // (b) Il file arriva su disco con i byte giusti.
    const dir = await dlDir(app);
    const target = join(dir, 'rapporto.zip');
    await expect.poll(() => existsSync(target), { timeout: 20000 }).toBe(true);
    await expect.poll(() => statSync(target).size, { timeout: 20000 }).toBe(BODY.length);
    expect(readFileSync(target).equals(BODY)).toBe(true);

    // (c) Toast di conferma con "Apri file" / "Apri cartella".
    await expect.poll(async () => (await readToasts(shell)).map((t) => t.text).join('|'), { timeout: 15000 })
      .toContain('rapporto.zip');
    const toasts = await readToasts(shell);
    const done = toasts.find((t) => t.text.includes('rapporto.zip'));
    expect(done.actions).toContain('Apri file');
    expect(done.actions).toContain('Apri cartella');

    // (d) La cronologia registra "completato" ed è PERSISTITA su disco.
    const items = await shell.evaluate(() => window.filoShell.downloads.list());
    const rec = items.items.find((r) => r.filename === 'rapporto.zip');
    expect(rec, 'nessuna voce in cronologia').toBeTruthy();
    expect(rec.state).toBe('completed');
    expect(rec.totalBytes).toBe(BODY.length);
    expect(rec.receivedBytes).toBe(BODY.length);
    expect(rec.savePath).toBe(target);

    const ud = await userData(app);
    await expect.poll(() => {
      try {
        const raw = JSON.parse(readFileSync(join(ud, 'storage.json'), 'utf8'));
        const arr = raw.downloads || raw?.data?.downloads || [];
        return JSON.stringify(arr).includes('rapporto.zip') && JSON.stringify(arr).includes('completed');
      } catch (_) { return false; }
    }, { timeout: 15000 }).toBe(true);

    // (e) Il pannello si apre e mostra la voce.
    await shell.click('#dl-indicator');
    await shell.waitForSelector('#dl-panel:not([hidden])', { timeout: 5000 });
    const panelText = await shell.evaluate(() => document.getElementById('dl-panel')?.innerText || '');
    expect(panelText).toContain('rapporto.zip');
    await shell.screenshot({ path: 'tests/.shots/verify410-panel.png' }).catch(() => {});
  } finally { await srv.close(); }
});

test('2) ERRORE: server che tronca → toast d\'errore + cronologia "interrotto", niente silenzio', async ({ app, shell, openTab }) => {
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(['/rotto.bin'])); },
    '/rotto.bin': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(5 * 1024 * 1024),
        'Content-Disposition': 'attachment; filename="rotto.bin"',
      });
      res.write(Buffer.alloc(32 * 1024, 1));
      setTimeout(() => { try { res.socket.destroy(); } catch (_) {} }, 200);
    },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl0');

    await expect.poll(async () => (await readToasts(shell)).map((t) => t.text).join('|'), { timeout: 30000 })
      .toMatch(/non riuscit/i);

    const items = await shell.evaluate(() => window.filoShell.downloads.list());
    const rec = items.items.find((r) => r.filename.startsWith('rotto'));
    expect(rec).toBeTruthy();
    expect(rec.state).toBe('interrupted');
  } finally { await srv.close(); }
});

test('3) STRESS: nome file ostile (script/traversal/emoji/lunghissimo) non evade la cartella né esegue codice', async ({ app, shell, openTab }) => {
  const NAMES = [
    '../../../../evaso.txt',
    '<script>alert(1)</script>.txt',
    '   .txt',
    'lungo' + 'x'.repeat(400) + '.txt',
  ];
  const routes = { '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(NAMES.map((_, i) => `/f${i}`))); } };
  NAMES.forEach((n, i) => {
    routes[`/f${i}`] = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '4',
        'Content-Disposition': `attachment; filename="${n.replace(/"/g, '')}"`,
      });
      res.end('ciao');
    };
  });
  const srv = await attachServer(routes);
  try {
    const page = await openTab(`${srv.origin}/p`);
    let alerted = false;
    shell.on('dialog', (d) => { alerted = true; d.dismiss().catch(() => {}); });
    for (let i = 0; i < NAMES.length; i++) { await page.click(`#dl${i}`); await page.waitForTimeout(400); }

    await expect.poll(async () => (await shell.evaluate(() => window.filoShell.downloads.list())).items.length, { timeout: 25000 })
      .toBeGreaterThanOrEqual(NAMES.length);
    await shell.waitForTimeout(1500);

    const dir = await dlDir(app);
    const files = readdirSync(dir);
    console.log('file scritti:', JSON.stringify(files));
    // Nessun file fuori dalla cartella download.
    expect(existsSync(join(dir, '..', '..', '..', '..', 'evaso.txt'))).toBe(false);

    // Il pannello mostra i nomi come TESTO, non come HTML.
    await shell.click('#dl-indicator');
    await shell.waitForSelector('#dl-panel:not([hidden])', { timeout: 5000 });
    const scripts = await shell.evaluate(() => document.querySelectorAll('#dl-panel script').length);
    expect(scripts).toBe(0);
    expect(alerted).toBe(false);
    await shell.screenshot({ path: 'tests/.shots/verify410-hostile.png' }).catch(() => {});
  } finally { await srv.close(); }
});

test('4) STRESS: due download con lo STESSO nome in parallelo non si sovrascrivono', async ({ app, shell, openTab }) => {
  const A = Buffer.alloc(300 * 1024, 0x61);
  const B = Buffer.alloc(300 * 1024, 0x62);
  const bodies = { '/a': A, '/b': B };
  const routes = { '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(['/a', '/b'])); } };
  for (const [p, body] of Object.entries(bodies)) {
    routes[p] = (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(body.length),
        'Content-Disposition': 'attachment; filename="stesso.bin"',
      });
      let off = 0;
      const tick = () => {
        if (off >= body.length) { res.end(); return; }
        res.write(body.subarray(off, off + 32 * 1024));
        off += 32 * 1024;
        setTimeout(tick, 40);
      };
      tick();
    };
  }
  const srv = await attachServer(routes);
  try {
    const page = await openTab(`${srv.origin}/p`);
    // Due scaricamenti SOVRAPPOSTI dello stesso nome: il secondo parte mentre il
    // primo è ancora a metà (nello stesso tick Chromium ne avvia uno solo).
    await page.click('#dl0');
    await page.waitForTimeout(120);
    await page.click('#dl1');

    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return r.items.every((x) => x.state !== 'progressing' && x.state !== 'paused') && r.items.length >= 2;
    }, { timeout: 40000 }).toBe(true);

    const items = (await shell.evaluate(() => window.filoShell.downloads.list())).items;
    console.log('stati:', JSON.stringify(items.map((i) => ({ f: i.filename, s: i.state, r: i.receivedBytes, t: i.totalBytes, p: i.savePath }))));
    expect(items.filter((x) => x.state === 'completed').length, 'non tutti i download paralleli sono arrivati a "completato"').toBe(2);
    const paths = items.map((i) => i.savePath);
    console.log('percorsi salvati:', JSON.stringify(paths));
    expect(new Set(paths).size, `i due download hanno scritto sullo STESSO percorso: ${paths}`).toBe(2);

    const dir = await dlDir(app);
    const files = readdirSync(dir).filter((f) => f.startsWith('stesso'));
    console.log('file su disco:', JSON.stringify(files));
    expect(files.length).toBe(2);
    const contents = files.map((f) => readFileSync(join(dir, f)));
    expect(contents.every((c) => c.length === 300 * 1024)).toBe(true);
    // I contenuti devono essere DIVERSI (uno di 'a', uno di 'b'): se sono
    // uguali un download ha sovrascritto l'altro.
    expect(contents[0].equals(contents[1])).toBe(false);
  } finally { await srv.close(); }
});

test('5) SICUREZZA: una pagina web esterna non deve poter elencare/aprire gli scaricamenti', async ({ app, shell, openTab }) => {
  // Prima facciamo arrivare un download vero, così la cronologia non è vuota.
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(['/segreto.pdf'])); },
    '/segreto.pdf': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '5', 'Content-Disposition': 'attachment; filename="segreto.pdf"' });
      res.end('%PDF-');
    },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl0');
    await expect.poll(async () => (await shell.evaluate(() => window.filoShell.downloads.list())).items.length, { timeout: 20000 }).toBeGreaterThan(0);

    // Stesso schema degli altri audit d'origine del repo: si esercita l'handler
    // reale con un mittente di origine web esterna.
    const dispatch = (msg, sender) =>
      app.evaluate((_e, { msg, sender }) => globalThis.SN_HANDLE_MESSAGE(msg, sender), { msg, sender });
    const web = { tab: { id: 7, url: 'http://evil.example/' }, url: 'http://evil.example/' };
    const filo = { tab: { id: 8, url: 'filo://newtab/' }, url: 'filo://newtab/' };

    const list = await dispatch({ type: 'downloads_list' }, web);
    console.log('downloads_list da origine web →', JSON.stringify(list).slice(0, 400));
    expect(list.error, 'una pagina web esterna può ELENCARE gli scaricamenti: nomi, indirizzi e percorsi completi su disco').toBe('forbidden');

    // Dalla lista si ricava l'id e si può far APRIRE il file al sistema operativo.
    const id = (await shell.evaluate(() => window.filoShell.downloads.list())).items[0].id;
    const open = await dispatch({ type: 'download_open_file', id }, web);
    console.log('download_open_file da origine web →', JSON.stringify(open));
    expect(open.error, 'una pagina web esterna può far APRIRE al sistema un file scaricato').toBe('forbidden');

    const rm = await dispatch({ type: 'download_remove', id }, web);
    expect(rm.error, 'una pagina web esterna può cancellare voci dalla cronologia scaricamenti').toBe('forbidden');

    // Da filo:// deve invece passare.
    const okList = await dispatch({ type: 'downloads_list' }, filo);
    expect(okList.ok).toBe(true);
  } finally { await srv.close(); }
});

test('6) REGRESSIONE: un server LENTO ma sano (pausa di 9s a metà) non deve essere dichiarato fallito', async ({ app, shell, openTab }) => {
  // Una pausa di alcuni secondi a metà trasferimento è normalissima: rete
  // congestionata, connessione mobile, file generato lato server. Il download
  // deve arrivare a destinazione, non essere ucciso e segnalato come errore.
  const BODY = Buffer.alloc(200 * 1024, 7);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlPage(['/lento.bin'])); },
    '/lento.bin': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(BODY.length),
        'Content-Disposition': 'attachment; filename="lento.bin"',
      });
      res.write(BODY.subarray(0, 64 * 1024));
      setTimeout(() => res.end(BODY.subarray(64 * 1024)), 9000);
    },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl0');
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      return r.items[0] ? r.items[0].state : '';
    }, { timeout: 45000 }).not.toBe('progressing');

    const items = (await shell.evaluate(() => window.filoShell.downloads.list())).items;
    console.log('esito server lento:', JSON.stringify(items.map((i) => ({ f: i.filename, s: i.state, rb: i.receivedBytes, tb: i.totalBytes }))));
    const dir = await dlDir(app);
    const target = join(dir, 'lento.bin');
    expect(items[0].state, 'un server semplicemente lento viene scambiato per un guasto e lo scaricamento viene annullato').toBe('completed');
    expect(existsSync(target) && statSync(target).size === BODY.length, 'il file di un server lento non arriva su disco').toBe(true);
  } finally { await srv.close(); }
});
