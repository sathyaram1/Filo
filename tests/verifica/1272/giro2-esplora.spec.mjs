// Verifica #1272, giro 2: esplorazione. Proxy con la password e il paese nel nome, riquadri, pagine che cambiano
// indirizzo senza ricaricare.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PASSWORD = 'segreta';

async function proxyHttp() {
  const uscite = [];
  const live = new Set();
  const nega = (a) => {
    const s = String(a || '');
    const [utente, password] = s.startsWith('Basic ') ? Buffer.from(s.slice(6), 'base64').toString().split(':') : ['', ''];
    return password === PASSWORD ? utente : null;
  };
  const server = createHttpServer((req, res) => {
    const utente = nega(req.headers['proxy-authorization']);
    if (utente === null) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="prova"' }); res.end(); return; }
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); res.end(); return; }
    uscite.push({ utente, host: u.hostname, percorso: u.pathname, origin: String(req.headers.origin || ''), referer: String(req.headers.referer || '') });
    const h = { ...req.headers };
    delete h['proxy-authorization'];
    delete h['proxy-connection'];
    const up = httpRequest({ host: '127.0.0.1', port: Number(u.port), path: u.pathname + u.search, method: req.method, headers: h }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
    req.pipe(up);
  });
  server.on('connect', (req, socket) => {
    const utente = nega(req.headers['proxy-authorization']);
    const [host] = String(req.url).split(':');
    if (utente === null) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="prova"\r\nContent-Length: 0\r\n\r\n'); return; }
    uscite.push({ utente, host, percorso: 'CONNECT' });
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('connection', (s) => { live.add(s); s.on('close', () => live.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    uscite,
    async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); },
  };
}

async function startSocks5() {
  const live = new Set();
  const server = createNetServer((socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (req) => {
        const len = req[4];
        const port = req.readUInt16BE(5 + len);
        const upstream = netConnect(port, '127.0.0.1', () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { upstream.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); } };
}

async function sito(pagine) {
  const visti = [];
  const server = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    visti.push({ host: String(req.headers.host || '').split(':')[0], percorso, referer: String(req.headers.referer || ''), origin: String(req.headers.origin || '') });
    const p = pagine[percorso];
    if (!p) { res.writeHead(404); res.end(); return; }
    if (p.tipo === 'image/png' && req.headers.origin) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'content-type': p.tipo, 'cache-control': 'no-store', ...(p.headers || {}) });
    res.end(p.corpo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    visti,
    dalMain: () => visti.filter((v) => v.percorso === '/foto.png' && !v.origin),
    async close() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return a.fn === 'proxy' ? t.setTabProxy(a.id, a.paese) : (a.fn === 'nav' ? t.navigate(a.id, a.url) : t.activeId);
}, { fn, ...arg });

async function paginaCon(app, predicate, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const p of app.windows().filter((w) => { try { return !w.isClosed() && predicate(w.url()); } catch (_) { return false; } }).reverse()) {
      try { await p.waitForSelector(selector, { timeout: 2000 }); return p; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina non trovata');
}

async function schedaCol(app, openTab, testServer, endpoint) {
  const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
  await avvio.waitForSelector('#avvio');
  await app.evaluate(async (_e, ep) => { await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: ep, bypass: '<-loopback>' } }); }, endpoint);
  return tm(app, 'id', {});
}

async function vai(app, id, paese, url, sel = '#foto') {
  if (paese) expect((await tm(app, 'proxy', { id, paese })).ok).toBe(true);
  await tm(app, 'nav', { id, url });
  const page = await paginaCon(app, (u) => u === url, sel);
  return page;
}

test('esplora: proxy con password e paese nel nome, immagine e anteprima escono dal paese giusto', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const s = await sito(pagine);
  const P = s.port;
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><body style="padding:24px">
      <img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160">
      <p><a id="link" href="http://link.filo.invalid:${P}/articolo">articolo</a></p></body>` },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
    '/articolo': { tipo: 'text/html', corpo: '<title>Articolo</title>' },
  });
  const proxy = await proxyHttp();
  try {
    const id = await schedaCol(app, openTab, testServer, `http://utente-{country}:${PASSWORD}@127.0.0.1:${proxy.port}`);
    for (const paese of ['US', 'DE']) {
      const page = await vai(app, id, paese, `http://pagina.filo.invalid:${P}/pagina?p=${paese}`);
      await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
      const prima = proxy.uscite.length;
      await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
      await expect.poll(() => proxy.uscite.slice(prima).filter((u) => u.percorso === '/foto.png' && !u.origin).length, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await page.locator('#link').click({ button: 'right' });
      await expect.poll(() => proxy.uscite.slice(prima).filter((u) => u.percorso === '/articolo').length, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      const utenti = [...new Set(proxy.uscite.slice(prima).map((u) => u.utente))];
      expect(utenti, `da ${paese}`).toEqual([`utente-${paese.toLowerCase()}`]);
    }
    expect(s.visti.filter((v) => v.percorso !== '/pagina' && !proxy.uscite.some((u) => u.percorso === v.percorso))).toEqual([]);
  } finally {
    await s.close();
    await proxy.close();
  }
});

test('esplora: Referer da un riquadro e da una pagina che cambia indirizzo senza ricaricare', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const s = await sito(pagine);
  const P = s.port;
  const img = `<img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160">`;
  Object.assign(pagine, {
    '/con-riquadro': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><body><p id="foto">x</p>
      <iframe id="r" src="http://riquadro.filo.invalid:${P}/riquadro?segreto=1" width="400" height="300"></iframe></body>` },
    '/riquadro': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><body style="margin:0">${img}</body>` },
    '/muta': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><body style="padding:24px">${img}</body>`, headers: { 'Referrer-Policy': 'no-referrer' } },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  const socks = await startSocks5();
  try {
    const id = await schedaCol(app, openTab, testServer, `socks5://127.0.0.1:${socks.port}`);
    expect((await tm(app, 'proxy', { id, paese: 'US' })).ok).toBe(true);

    const page = await vai(app, id, null, `http://pagina.filo.invalid:${P}/con-riquadro?q=1`);
    const frame = page.frameLocator('#r');
    await frame.locator('#foto').waitFor();
    let prima = s.dalMain().length;
    await frame.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => s.dalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
    await page.keyboard.press('Escape');
    expect(s.dalMain().slice(prima).map((v) => v.referer), 'nel riquadro conta il riquadro').toEqual(s.dalMain().slice(prima).map(() => `http://riquadro.filo.invalid:${P}/`));

    const muta = await vai(app, id, null, `http://pagina.filo.invalid:${P}/muta?q=1`);
    await muta.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    await muta.evaluate(() => history.pushState({}, '', '/altra-vista?q=2'));
    prima = s.dalMain().length;
    await muta.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => s.dalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
    await muta.keyboard.press('Escape');
    expect(s.dalMain().slice(prima).map((v) => v.referer), 'la pagina ha chiesto di non dire da dove viene').toEqual(s.dalMain().slice(prima).map(() => ''));
  } finally {
    await s.close();
    await socks.close();
  }
});
