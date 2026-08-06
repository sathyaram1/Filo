// VERIFICA (verifier, #412) — black-box dal sintomo utente:
// "un pulsante Scarica che apre una nuova scheda: Filo apre la scheda, la porta
//  in primo piano e la lascia bianca per sempre (titolo 'Nuova scheda'), mentre
//  non c'è nessun segno che qualcosa sia stato scaricato".
//
// Non guarda il diff: esercita l'app come farebbe l'utente.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

test.setTimeout(120_000);

async function attachServer(routes) {
  const server = createServer((req, res) => {
    const url = req.url.split('?')[0];
    const h = routes[url];
    if (!h) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>non trovato</h1>'); return; }
    h(req, res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); }),
  };
}

const attach = (body, name, extra = {}) => (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    'Content-Disposition': `attachment; filename="${name}"`,
    ...extra,
  });
  res.end(body);
};

const snap = (shell) => shell.evaluate(() => window.filoShell.tabs.snapshot());
const dlDir = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const userData = (app) => app.evaluate(() => process.env.FILO_USER_DATA);
const readToasts = (shell) => shell.evaluate(() => Array.from(document.querySelectorAll('.shell-notif')).map((c) => c.querySelector('.shell-notif-msg')?.textContent || ''));

// Una scheda "fantasma" = quella che l'utente descrive: nessun indirizzo e
// titolo di ripiego. È esattamente ciò che non deve restare.
const ghosts = (s) => s.tabs.filter((t) => !t.url || t.url === 'about:blank' || t.url === '');

test('1) SINTOMO: pulsante Scarica con apertura in nuova scheda → il file arriva e NON resta nessuna scheda vuota', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(200 * 1024, 0x42);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Pagina di partenza</title><body><a id="dl" href="/rapporto.zip" target="_blank">Scarica</a></body>'); },
    '/rapporto.zip': attach(BODY, 'rapporto.zip'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    const originId = before.activeId;
    expect(ghosts(before).length, 'la pagina di partenza parte pulita').toBe(0);
    await shell.screenshot({ path: 'tests/.shots/412-prima.png' }).catch(() => {});

    await page.click('#dl');

    // (a) SUCCESSO: il file arriva davvero, coi byte giusti.
    const dir = await dlDir(app);
    const target = join(dir, 'rapporto.zip');
    await expect.poll(() => existsSync(target), { timeout: 30000 }).toBe(true);
    await expect.poll(() => statSync(target).size, { timeout: 20000 }).toBe(BODY.length);

    // (b) Nessuna scheda fantasma, nemmeno dopo diversi secondi.
    await expect.poll(async () => ghosts(await snap(shell)).length, { timeout: 20000 }).toBe(0);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    console.log('schede dopo:', JSON.stringify(after.tabs.map((t) => ({ u: t.url, t: t.title }))));
    expect(ghosts(after).length, 'resta una scheda vuota').toBe(0);
    expect(after.tabs.length, 'il numero di schede è tornato come prima').toBe(before.tabs.length);

    // (c) Il fuoco è tornato sulla pagina di partenza.
    expect(after.activeId).toBe(originId);

    // (d) L'utente vede che qualcosa è stato scaricato.
    await expect.poll(async () => (await readToasts(shell)).join('|'), { timeout: 20000 }).toContain('rapporto.zip');
  } finally { await srv.close(); }
});

test('2) CONTROLLO: apri-in-nuova-scheda verso una pagina vera resta aperta', async ({ shell, openTab }) => {
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="go" href="/altra" target="_blank">Apri</a></body>'); },
    '/altra': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Pagina figlia</title><body><h1>contenuto vero</h1></body>'); },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    await page.click('#go');
    await expect.poll(async () => (await snap(shell)).tabs.some((t) => (t.url || '').endsWith('/altra')), { timeout: 15000 }).toBe(true);
    await shell.waitForTimeout(4000);
    const after = await snap(shell);
    const child = after.tabs.find((t) => (t.url || '').endsWith('/altra'));
    expect(child, 'la scheda legittima è stata chiusa per sbaglio').toBeTruthy();
    expect(child.title).toContain('Pagina figlia');
    expect(after.tabs.length).toBe(before.tabs.length + 1);
  } finally { await srv.close(); }
});

test('3) STRESS: tre clic rapidi sul pulsante Scarica → tre file, zero schede vuote', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(64 * 1024, 0x43);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/f.bin" target="_blank">Scarica</a></body>'); },
    '/f.bin': attach(BODY, 'f.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    const originId = before.activeId;
    await page.evaluate(() => { const a = document.getElementById('dl'); a.click(); a.click(); a.click(); });

    await expect.poll(async () => {
      const dir = await dlDir(app);
      try { return readdirSync(dir).filter((f) => f.startsWith('f')).length; } catch (_) { return 0; }
    }, { timeout: 40000 }).toBeGreaterThanOrEqual(3);

    await expect.poll(async () => ghosts(await snap(shell)).length, { timeout: 25000 }).toBe(0);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    console.log('dopo tripla:', JSON.stringify(after.tabs.map((t) => t.url)));
    expect(ghosts(after).length).toBe(0);
    expect(after.tabs.length).toBe(before.tabs.length);
    expect(after.activeId).toBe(originId);
  } finally { await srv.close(); }
});

test('4) STRESS: download dalla scheda CORRENTE (senza nuova scheda) → la pagina resta dov’è', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(32 * 1024, 0x44);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Resta qui</title><body><h1>testo</h1><a id="dl" href="/qui.bin" download>Scarica</a></body>'); },
    '/qui.bin': attach(BODY, 'qui.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    const originId = before.activeId;
    await page.click('#dl');
    const dir = await dlDir(app);
    await expect.poll(() => existsSync(join(dir, 'qui.bin')), { timeout: 30000 }).toBe(true);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    const still = after.tabs.find((t) => t.id === originId);
    expect(still, 'la scheda da cui scaricavo è stata chiusa!').toBeTruthy();
    expect(still.url).toContain('/p');
    expect(after.activeId).toBe(originId);
    expect(after.tabs.length).toBe(before.tabs.length);
  } finally { await srv.close(); }
});

test('5) STRESS: window.open() da JS verso un file → nessuna scheda vuota', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(16 * 1024, 0x45);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><button id="b" onclick="window.open(\'/js.bin\',\'_blank\')">Scarica</button></body>'); },
    '/js.bin': attach(BODY, 'js.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    await page.click('#b');
    const dir = await dlDir(app);
    await expect.poll(() => existsSync(join(dir, 'js.bin')), { timeout: 30000 }).toBe(true);
    await expect.poll(async () => ghosts(await snap(shell)).length, { timeout: 25000 }).toBe(0);
    await shell.waitForTimeout(2500);
    const after = await snap(shell);
    console.log('dopo window.open:', JSON.stringify(after.tabs.map((t) => t.url)));
    expect(ghosts(after).length).toBe(0);
    expect(after.tabs.length).toBe(before.tabs.length);
  } finally { await srv.close(); }
});

test('6) STRESS: download interrotto dal server → niente scheda vuota, e l’utente lo sa', async ({ shell, openTab }) => {
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/rotto.bin" target="_blank">Scarica</a></body>'); },
    '/rotto.bin': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(5 * 1024 * 1024),
        'Content-Disposition': 'attachment; filename="rotto.bin"',
      });
      res.write(Buffer.alloc(32 * 1024, 0x46));
      setTimeout(() => { try { req.socket.destroy(); } catch (_) {} }, 400);
    },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    const originId = before.activeId;
    await page.click('#dl');
    await expect.poll(async () => ghosts(await snap(shell)).length, { timeout: 30000 }).toBe(0);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    console.log('dopo interruzione:', JSON.stringify(after.tabs.map((t) => ({ u: t.url, t: t.title }))));
    expect(ghosts(after).length, 'scheda vuota rimasta dopo download fallito').toBe(0);
    expect(after.tabs.length).toBe(before.tabs.length);
    expect(after.activeId).toBe(originId);
  } finally { await srv.close(); }
});

test('7) STRESS: nome file ostile (HTML/emoji/lunghissimo) → nessuno script eseguito, nessuna scheda vuota', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(4096, 0x47);
  // Nome ostile: HTML iniettabile + emoji (via RFC5987, gli header sono latin1) + lunghissimo.
  const evilAscii = '<img src=x onerror=alert(1)>' + 'A'.repeat(300) + '.bin';
  const evilUtf8 = encodeURIComponent('<img src=x onerror=alert(1)>😀' + 'A'.repeat(300) + '.bin');
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/evil" target="_blank">Scarica</a></body>'); },
    '/evil': (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(BODY.length),
        'Content-Disposition': `attachment; filename="${evilAscii}"; filename*=UTF-8''${evilUtf8}`,
      });
      res.end(BODY);
    },
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    const before = await snap(shell);
    let dialog = false;
    shell.on('dialog', async (d) => { dialog = true; await d.dismiss(); });
    await page.click('#dl');
    await shell.waitForTimeout(9000);
    const after = await snap(shell);
    console.log('dopo nome ostile:', JSON.stringify(after.tabs.map((t) => t.url)));
    expect(dialog, 'un alert() dal nome file è stato eseguito').toBe(false);
    // Nessun <img> iniettato nei toast della shell (verifica anti-XSS reale).
    const injected = await shell.evaluate(() => Array.from(document.querySelectorAll('.shell-notif img')).length);
    expect(injected).toBe(0);
    expect(ghosts(after).length, 'scheda vuota rimasta').toBe(0);
    expect(after.tabs.length).toBe(before.tabs.length);
    // La app è ancora viva e reattiva.
    const ok = await shell.evaluate(async () => !!(await window.filoShell.tabs.snapshot()));
    expect(ok).toBe(true);
  } finally { await srv.close(); }
});

test('8) INVARIANTE: la scheda-contenitore chiusa non sporca l’archivio delle schede chiuse', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(8192, 0x48);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/arch.bin" target="_blank">Scarica</a></body>'); },
    '/arch.bin': attach(BODY, 'arch.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl');
    const dir = await dlDir(app);
    await expect.poll(() => existsSync(join(dir, 'arch.bin')), { timeout: 30000 }).toBe(true);
    await shell.waitForTimeout(3000);
    const archived = await shell.evaluate(() => window.filoShell.message({ type: 'get_archived_tabs' }));
    console.log('archivio:', JSON.stringify(archived));
    if (archived && Array.isArray(archived.items)) {
      const bad = archived.items.filter((t) => !t.url || t.url === 'about:blank' || (t.title || '').includes('Nuova scheda'));
      expect(bad.length, 'una scheda vuota è finita nell’archivio').toBe(0);
    }
  } finally { await srv.close(); }
});

test('9) STRESS: la scheda di partenza è l’UNICA aperta → resta almeno una scheda usabile', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(8192, 0x49);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Unica</title><body><a id="dl" href="/solo.bin" target="_blank">Scarica</a></body>'); },
    '/solo.bin': attach(BODY, 'solo.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    // Chiude tutte le altre schede: resta solo la pagina di partenza.
    const s0 = await snap(shell);
    const originId = s0.activeId;
    for (const t of s0.tabs) {
      if (t.id !== originId) await shell.evaluate((id) => window.filoShell.tabs.close(id), t.id);
    }
    await expect.poll(async () => (await snap(shell)).tabs.length, { timeout: 10000 }).toBe(1);

    await page.click('#dl');
    const dir = await dlDir(app);
    await expect.poll(() => existsSync(join(dir, 'solo.bin')), { timeout: 30000 }).toBe(true);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    console.log('scheda unica dopo:', JSON.stringify(after.tabs.map((t) => ({ u: t.url, t: t.title }))));
    expect(after.tabs.length, 'zero schede: la finestra resta vuota').toBeGreaterThanOrEqual(1);
    expect(ghosts(after).length).toBe(0);
    expect(after.activeId).toBe(originId);
  } finally { await srv.close(); }
});

test('10) STRESS: interstiziale con contenuto vero che poi scarica → la pagina con contenuto NON viene chiusa a sorpresa', async ({ app, shell, openTab }) => {
  const BODY = Buffer.alloc(8192, 0x4a);
  const srv = await attachServer({
    '/p': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Partenza</title><body><a id="dl" href="/wait" target="_blank">Scarica</a></body>'); },
    '/wait': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Il download parte a breve</title><body><h1>Grazie, il download parte a breve…</h1><script>setTimeout(()=>{location.href="/inter.bin";},1200)</script></body>');
    },
    '/inter.bin': attach(BODY, 'inter.bin'),
  });
  try {
    const page = await openTab(`${srv.origin}/p`);
    await page.click('#dl');
    const dir = await dlDir(app);
    await expect.poll(() => existsSync(join(dir, 'inter.bin')), { timeout: 30000 }).toBe(true);
    await shell.waitForTimeout(3000);
    const after = await snap(shell);
    console.log('interstiziale dopo:', JSON.stringify(after.tabs.map((t) => ({ u: t.url, t: t.title }))));
    // Nessuna scheda fantasma in ogni caso.
    expect(ghosts(after).length, 'scheda fantasma dopo interstiziale').toBe(0);
  } finally { await srv.close(); }
});
