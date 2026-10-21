// Verifica #1272, giro 2, rilievo 1: una pagina che con l'intestazione Referrer-Policy chiede di non dire da dove viene
// lo chiede anche dopo aver cambiato indirizzo senza ricaricare (history.pushState, come fanno le app a pagina unica).

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

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

test('r1 il Referer tace anche dopo che la pagina col no-referrer nell\'intestazione ha cambiato indirizzo senza ricaricare', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const pagine = {};
  const s = await sito(pagine);
  const P = s.port;
  const img = `<img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160">`;
  Object.assign(pagine, {
    '/muta': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><body style="padding:24px">${img}</body>`, headers: { 'Referrer-Policy': 'no-referrer' } },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  const socks = await startSocks5();
  try {
    const id = await schedaCol(app, openTab, testServer, `socks5://127.0.0.1:${socks.port}`);
    expect((await tm(app, 'proxy', { id, paese: 'US' })).ok).toBe(true);

    const muta = await vai(app, id, null, `http://pagina.filo.invalid:${P}/muta?q=1`);
    await muta.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    await muta.evaluate(() => history.pushState({}, '', '/altra-vista?q=2'));
    const prima = s.dalMain().length;
    await muta.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => s.dalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
    await muta.keyboard.press('Escape');
    expect(s.dalMain().slice(prima).map((v) => v.referer), 'la pagina ha chiesto di non dire da dove viene').toEqual(s.dalMain().slice(prima).map(() => ''));
  } finally {
    await s.close();
    await socks.close();
  }
});
