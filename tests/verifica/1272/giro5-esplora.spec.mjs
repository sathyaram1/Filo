// Verifica #1272 giro 5: esplorazione delle porte non coperte dallo spec del lavoro (riquadro, Salva immagine come,
// proxy con password per i byte delle immagini).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import fs from 'node:fs';
import path from 'node:path';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function startSocks5() {
  const porte = new Set();
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
        const up = netConnect(port, '127.0.0.1', () => {
          porte.add(up.localPort);
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(up); up.pipe(socket);
        });
        up.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { up.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, porte, async close() { for (const s of live) s.destroy(); await new Promise((r) => server.close(r)); } };
}

async function proxyConPassword() {
  const uscite = [];
  const live = new Set();
  const server = createHttpServer((req, res) => {
    const a = String(req.headers['proxy-authorization'] || '');
    const [, password] = a.startsWith('Basic ') ? Buffer.from(a.slice(6), 'base64').toString().split(':') : ['', ''];
    if (password !== 'segreta') { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="prova"' }); res.end(); return; }
    const u = new URL(req.url);
    uscite.push(u.pathname);
    const h = { ...req.headers };
    delete h['proxy-authorization'];
    const up = httpRequest({ host: '127.0.0.1', port: Number(u.port), path: u.pathname + u.search, method: req.method, headers: h }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) {} });
    req.pipe(up);
  });
  server.on('connection', (s) => { live.add(s); s.on('close', () => live.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, uscite, async close() { for (const s of live) s.destroy(); await new Promise((r) => server.close(r)); } };
}

async function sito(pagine, porteProxy) {
  const visti = [];
  const server = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    visti.push({ host: String(req.headers.host || '').split(':')[0], percorso, referer: String(req.headers.referer || ''), origin: String(req.headers.origin || ''), dalProxy: porteProxy ? porteProxy.has(req.socket.remotePort) : null });
    const p = pagine[percorso];
    if (!p) { res.writeHead(404); res.end(); return; }
    if (p.tipo === 'image/png' && req.headers.origin) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'content-type': p.tipo, 'cache-control': 'no-store', ...(p.headers || {}) });
    res.end(p.corpo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, visti, byteDalMain: () => visti.filter((v) => v.percorso === '/foto.png' && !v.origin), async close() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

async function waitPageWith(app, predicate, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const c = app.windows().filter((w) => { try { return !w.isClosed() && predicate(w.url()); } catch (_) { return false; } });
    for (const p of c.reverse()) { try { await p.waitForSelector(selector, { timeout: 2000 }); return p; } catch (_) {} }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('nessuna pagina');
}

async function schedaColProxy(app, openTab, testServer, endpoint) {
  const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
  await avvio.waitForSelector('#avvio');
  await app.evaluate(async (_e, ep) => { await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: ep, bypass: '<-loopback>' } }); }, endpoint);
  const id = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); return w._filoTabs.tabs.find((t) => /^https?:/.test(t.url || '')).id; });
  const r = await app.evaluate(({ BrowserWindow }, tabId) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setTabProxy(tabId, 'US'), id);
  expect(r.ok).toBe(true);
  return id;
}

async function apri(app, tabId, url, sel) {
  await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigate(a.tabId, a.url); }, { tabId, url });
  return waitPageWith(app, (u) => u === url, sel);
}

test('riquadro: il Referer dei byte è l\'origine del riquadro, e tace se il riquadro chiede no-referrer', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const socks = await startSocks5();
  const pagine = {};
  const s = await sito(pagine, socks.porte);
  const P = s.port;
  const foto = `http://immagini.filo.invalid:${P}/foto.png`;
  const riq = (id) => `<!doctype html><html><body style="margin:0"><img id="foto" src="${foto}" width="160" height="160"></body></html>`;
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html', corpo: `<!doctype html><html><body><p id="pronta">x</p><iframe id="r1" src="http://riquadro.filo.invalid:${P}/riq?x=1" width="300" height="200"></iframe><iframe id="r2" src="http://muto.filo.invalid:${P}/muto?y=2" width="300" height="200"></iframe></body></html>` },
    '/riq': { tipo: 'text/html', corpo: riq() },
    '/muto': { tipo: 'text/html', corpo: riq(), headers: { 'Referrer-Policy': 'no-referrer' } },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  try {
    const tabId = await schedaColProxy(app, openTab, testServer, `socks5://127.0.0.1:${socks.port}`);
    const page = await apri(app, tabId, `http://pagina.filo.invalid:${P}/pagina?q=segreta`, '#pronta');
    await page.frameLocator('#r1').locator('#foto').waitFor();
    await page.frameLocator('#r2').locator('#foto').waitFor();
    await page.waitForTimeout(800);
    let prima = s.byteDalMain().length;
    await page.frameLocator('#r1').locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => s.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
    const r1 = s.byteDalMain().slice(prima);
    console.log('riquadro r1', JSON.stringify(r1));
    expect(r1.every((v) => v.referer === `http://riquadro.filo.invalid:${P}/`)).toBe(true);
    await page.keyboard.press('Escape');
    prima = s.byteDalMain().length;
    await page.frameLocator('#r2').locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => s.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
    const r2 = s.byteDalMain().slice(prima);
    console.log('riquadro r2', JSON.stringify(r2));
    expect(r2.every((v) => v.referer === '')).toBe(true);
    expect(s.visti.filter((v) => !v.dalProxy)).toEqual([]);
  } finally { await s.close(); await socks.close(); }
});

test('Salva immagine come: dalla scheda col proxy, Referer all\'origine, file salvato', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const socks = await startSocks5();
  const pagine = {};
  const s = await sito(pagine, socks.porte);
  const P = s.port;
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html', corpo: `<!doctype html><html><body><img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160"></body></html>` },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  const dir = cartellaTemporanea('filo-1272-salva-');
  const dest = path.join(dir, 'foto.png');
  try {
    const tabId = await schedaColProxy(app, openTab, testServer, `socks5://127.0.0.1:${socks.port}`);
    await apri(app, tabId, `http://pagina.filo.invalid:${P}/pagina?q=segreta`, '#foto');
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, dest);
    const prima = s.byteDalMain().length;
    const r = await nelMondoDiFilo(app, 'pagina.filo.invalid', `chrome.runtime.sendMessage({ type: SN_MESSAGES.DOWNLOAD_IMAGE, url: document.getElementById('foto').src, politiche: [] })`);
    console.log('salva', JSON.stringify(r));
    expect(r && r.ok).toBe(true);
    expect(fs.readFileSync(dest).equals(PNG)).toBe(true);
    const req = s.byteDalMain().slice(prima);
    expect(req.length).toBeGreaterThan(0);
    expect(req.every((v) => v.dalProxy && v.referer === `http://pagina.filo.invalid:${P}/`)).toBe(true);
  } finally { await s.close(); await socks.close(); }
});

test('proxy con password: i byte di un\'immagine passano dal proxy che chiede le credenziali', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const proxy = await proxyConPassword();
  const pagine = {};
  const s = await sito(pagine, null);
  const P = s.port;
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html', corpo: `<!doctype html><html><body><img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160"></body></html>` },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  try {
    const tabId = await schedaColProxy(app, openTab, testServer, `http://utente-{country}:segreta@127.0.0.1:${proxy.port}`);
    const page = await apri(app, tabId, `http://pagina.filo.invalid:${P}/pagina`, '#foto');
    await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    const prima = s.byteDalMain().length;
    const letta = await nelMondoDiFilo(app, 'pagina.filo.invalid', `SN_ACTIONS.scaricaImmagine(document.getElementById('foto').src, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)`);
    console.log('letta', letta);
    expect(letta).toBe('data:image/png;base64,');
    expect(s.byteDalMain().length).toBeGreaterThan(prima);
  } finally { await s.close(); await proxy.close(); }
});
