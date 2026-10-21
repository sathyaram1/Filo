// Verifica #1272, giro 1, rilievo 1: con un fornitore che mette il paese nel nome utente (stesso indirizzo del proxy per
// tutti i paesi), una richiesta per un paese nuovo deve uscire con le credenziali di quel paese, non con quelle di prima.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';

const PASSWORD = 'segreta';

// Proxy HTTP di prova: chiede la password (407) e annota con quale utente (cioè da quale paese) è uscita ogni richiesta.
async function proxyColPaeseNelNome(sitoPorta) {
  const uscite = [];
  const live = new Set();
  const server = createHttpServer((req, res) => {
    const a = String(req.headers['proxy-authorization'] || '');
    const [utente, password] = a.startsWith('Basic ') ? Buffer.from(a.slice(6), 'base64').toString().split(':') : ['', ''];
    if (password !== PASSWORD) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="prova"' }); res.end(); return; }
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); res.end(); return; }
    uscite.push({ utente, host: u.hostname, percorso: u.pathname });
    const h = { ...req.headers };
    delete h['proxy-authorization'];
    delete h['proxy-connection'];
    const up = httpRequest({ host: '127.0.0.1', port: Number(u.port) || sitoPorta, path: u.pathname + u.search, method: req.method, headers: h }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
    req.pipe(up);
  });
  server.on('connection', (s) => { live.add(s); s.on('close', () => live.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    uscite,
    async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); },
  };
}

async function sito() {
  const server = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    const P = server.address().port;
    if (percorso.startsWith('/pagina')) {
      const n = percorso.slice('/pagina-'.length);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`<!doctype html><html><head><title>Pagina ${n}</title></head><body style="padding:24px">
        <p id="pronta">pagina ${n}</p>
        <p><a id="corto" href="http://bit.ly:${P}/corto-${n}" style="display:inline-block;padding:20px">link accorciato</a></p></body></html>`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end('<html><body>accorciatore</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, async close() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

const tm = (app, fn, arg) => app.evaluate(({ BrowserWindow }, a) => {
  const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  // eslint-disable-next-line no-new-func
  return new Function('t', 'a', `return (${a.fn})(t, a.arg);`)(t, a);
}, { fn: fn.toString(), arg });

async function paginaSu(app, url, selettore) {
  const fine = Date.now() + 30_000;
  while (Date.now() < fine) {
    const vive = app.windows().filter((w) => { try { return !w.isClosed() && w.url() === url; } catch (_) { return false; } }).reverse();
    for (const w of vive) {
      try { await w.waitForSelector(selettore, { timeout: 2000 }); return w; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`nessuna scheda viva su ${url}`);
}

async function inPaese(app, tabId, paese, url) {
  const r = await tm(app, (t, a) => t.setTabProxy(a.tabId, a.paese), { tabId, paese });
  expect(r.ok).toBe(true);
  await tm(app, (t, a) => t.navigate(a.tabId, a.url), { tabId, url });
  return paginaSu(app, url, '#pronta');
}

async function fermaSulLink(page) {
  const box = await page.locator('#corto').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

async function preparaProxy(app, openTab, testServer, proxy) {
  const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
  await avvio.waitForSelector('#avvio');
  await app.evaluate(async (_e, endpoint) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
  }, `http://utente-{country}:${PASSWORD}@127.0.0.1:${proxy.port}`);
  return tm(app, (t) => t.tabs.find((x) => /^https?:/.test(x.url || '')).id);
}

test('r1 la finestra nascosta di una scheda tedesca esce dalla Germania anche dopo un link controllato da una scheda americana', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const s = await sito();
  const proxy = await proxyColPaeseNelNome(s.port);
  try {
    const primaId = await preparaProxy(app, openTab, testServer, proxy);
    const americana = await inPaese(app, primaId, 'US', `http://pagina.filo.invalid:${s.port}/pagina-us`);
    await fermaSulLink(americana);
    await expect.poll(() => proxy.uscite.filter((u) => u.percorso === '/corto-us').map((u) => u.utente), { timeout: 20_000 })
      .toContain('utente-us');

    const seconda = await openTab(testServer.html('<title>seconda</title><p id="seconda">x</p>'));
    await seconda.waitForSelector('#seconda');
    const secondaId = await tm(app, (t) => t.activeId);
    const tedesca = await inPaese(app, secondaId, 'DE', `http://pagina.filo.invalid:${s.port}/pagina-de`);
    expect(proxy.uscite.filter((u) => u.percorso === '/pagina-de').map((u) => u.utente)).toEqual(['utente-de']);
    await fermaSulLink(tedesca);
    await expect.poll(() => proxy.uscite.filter((u) => u.percorso === '/corto-de').length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(proxy.uscite.filter((u) => u.percorso === '/corto-de').map((u) => u.utente),
      'il link accorciato visto da una scheda tedesca deve uscire dalla Germania').toEqual(['utente-de']);
  } finally {
    await s.close();
    await proxy.close();
  }
});

test('r1 una scheda americana portata in Germania esce dalla Germania', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const s = await sito();
  const proxy = await proxyColPaeseNelNome(s.port);
  try {
    const id = await preparaProxy(app, openTab, testServer, proxy);
    await inPaese(app, id, 'US', `http://pagina.filo.invalid:${s.port}/pagina-us`);
    expect(proxy.uscite.filter((u) => u.percorso === '/pagina-us').map((u) => u.utente)).toEqual(['utente-us']);
    await inPaese(app, id, 'DE', `http://pagina.filo.invalid:${s.port}/pagina-de`);
    expect(proxy.uscite.filter((u) => u.percorso === '/pagina-de').map((u) => u.utente),
      'cambiato paese, la pagina deve arrivare dalla Germania').toEqual(['utente-de']);
  } finally {
    await s.close();
    await proxy.close();
  }
});
