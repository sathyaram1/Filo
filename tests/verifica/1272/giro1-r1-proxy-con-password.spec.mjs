// Verifica #1272, giro 1: le richieste per conto della scheda passano anche da un proxy HTTP con utente e password,
// la forma dei fornitori veri (il paese sta nel nome utente). Il proxy di prova risponde 407 finché non riceve le credenziali.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ATTESA = 'Basic ' + Buffer.from('utente-us:segreta').toString('base64');

async function proxyConPassword(sitoPorta) {
  const porte = new Set();
  const richieste = [];
  const live = new Set();
  const server = createHttpServer((req, res) => {
    const ok = req.headers['proxy-authorization'] === ATTESA;
    richieste.push({ metodo: 'GET', url: req.url, ok });
    if (!ok) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="prova"' }); res.end(); return; }
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); res.end(); return; }
    const h = { ...req.headers };
    delete h['proxy-authorization'];
    delete h['proxy-connection'];
    const up = httpRequest({ host: '127.0.0.1', port: Number(u.port) || sitoPorta, path: u.pathname + u.search, method: req.method, headers: h }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('socket', (s) => s.on('connect', () => porte.add(s.localPort)));
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
    req.pipe(up);
  });
  server.on('connection', (s) => { live.add(s); s.on('close', () => live.delete(s)); });
  server.on('connect', (req, socket, head) => {
    const ok = req.headers['proxy-authorization'] === ATTESA;
    richieste.push({ metodo: 'CONNECT', url: req.url, ok });
    if (!ok) { socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="prova"\r\nContent-Length: 0\r\n\r\n'); return; }
    const port = Number(String(req.url).split(':').pop()) || 443;
    const up = netConnect(port, '127.0.0.1', () => {
      porte.add(up.localPort);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      socket.pipe(up); up.pipe(socket);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port, porte, richieste,
    async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); },
  };
}

test('da una scheda con un proxy HTTP con password, anteprima del link e byte di un\'immagine passano dal proxy', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const visti = [];
  let proxy = null;
  const pagine = {};
  const sito = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    visti.push({ host: String(req.headers.host || '').split(':')[0], percorso, origin: String(req.headers.origin || ''), dalProxy: !!proxy && proxy.porte.has(req.socket.remotePort) });
    const p = pagine[percorso];
    if (!p) { res.writeHead(404); res.end(); return; }
    if (p.tipo === 'image/png' && req.headers.origin) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'content-type': p.tipo, 'cache-control': 'no-store' });
    res.end(p.corpo);
  });
  await new Promise((r) => sito.listen(0, '127.0.0.1', r));
  const P = sito.address().port;
  proxy = await proxyConPassword(P);
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><html><head><title>Pagina</title></head><body style="padding:24px">
      <img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160">
      <p><a id="link" href="http://link.filo.invalid:${P}/articolo">un articolo</a></p></body></html>` },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
    '/articolo': { tipo: 'text/html; charset=utf-8', corpo: '<html><head><title>Articolo</title><meta property="og:title" content="Articolo dal proxy"></head><body>x</body></html>' },
  });
  try {
    const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
    await avvio.waitForSelector('#avvio');
    await app.evaluate(async (_e, endpoint) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
    }, `http://utente-us:segreta@127.0.0.1:${proxy.port}`);
    const id = await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) for (const t of w._filoTabs.tabs) if (/^https?:/.test(t.url || '')) return t.id;
      return null;
    });
    const res = await app.evaluate(({ BrowserWindow }, tabId) =>
      BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setTabProxy(tabId, 'US'), id);
    expect(res.ok).toBe(true);
    const url = `http://pagina.filo.invalid:${P}/pagina?q=1`;
    await app.evaluate(({ BrowserWindow }, a) => {
      BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigate(a.id, a.url);
    }, { id, url });
    let page = null;
    const fine = Date.now() + 30_000;
    while (!page && Date.now() < fine) {
      for (const w of app.windows().filter((x) => { try { return !x.isClosed() && x.url() === url; } catch (_) { return false; } }).reverse()) {
        try { await w.waitForSelector('#foto', { timeout: 2000 }); page = w; break; } catch (_) {}
      }
    }
    console.log('PROXY', JSON.stringify(proxy.richieste), 'VISTI', JSON.stringify(visti), JSON.stringify(res));
    console.log('RESOLVE', await app.evaluate(async ({ session }, a) => session.fromPartition(`proxy:${a.id}`).resolveProxy(a.url), { id, url }));
    expect(page, 'la pagina doveva aprirsi dal proxy con password').toBeTruthy();
    await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });

    await page.locator('#link').click({ button: 'right' });
    await expect.poll(() => visti.filter((v) => v.percorso === '/articolo').length, {
      timeout: 15_000, message: 'l\'anteprima del link doveva arrivare al sito passando dal proxy con password',
    }).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    const byte = () => visti.filter((v) => v.percorso === '/foto.png' && !v.origin).length;
    const prima = byte();
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(byte, {
      timeout: 15_000, message: 'i byte dell\'immagine dovevano arrivare passando dal proxy con password',
    }).toBeGreaterThan(prima);
    expect(visti.filter((v) => !v.dalProxy)).toEqual([]);
  } finally {
    await new Promise((r) => { try { sito.closeAllConnections(); } catch (_) {} sito.close(r); });
    if (proxy) await proxy.close();
  }
});
