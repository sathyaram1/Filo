// Verifica #753 giro 1: ogni sessione di Filo nasce protetta (GPC header e proprietà, blocco tracker).
// Scheda normale, incognito e proxata: script in <head> e iframe (stesso sito e altro sito) leggono true.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

async function serverGpc() {
  const richieste = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    richieste.push({ host: req.headers.host, path: u.pathname + u.search, gpc: req.headers['sec-gpc'] ?? null, h: JSON.stringify(req.headers) });
    const tag = u.searchParams.get('t') || '';
    const scrivi = `<script>(function(){var v=String(navigator.globalPrivacyControl);document.documentElement.dataset.gpc=v;
      try{parent!==window&&parent.postMessage({gpc:v,o:location.origin,t:${JSON.stringify(tag)}},'*')}catch(e){}})();</script>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/p') {
      const port = server.address().port;
      res.end(`<!doctype html><html><head>${scrivi}<script>window.__frames=[];addEventListener('message',function(e){window.__frames.push(e.data)});</script><title>P${tag}</title></head>
        <body><iframe src="/f?t=${tag}"></iframe><iframe src="http://localhost:${port}/f?t=${tag}"></iframe></body></html>`);
    } else if (u.pathname === '/f') {
      res.end(`<!doctype html><html><head>${scrivi}</head><body>frame</body></html>`);
    } else { res.end('ok'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, richieste, close: () => { server.closeAllConnections?.(); return new Promise((r) => server.close(r)); } };
}

async function startSocks5() {
  const connections = [];
  const live = new Set();
  const server = createNetServer((socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (greeting) => {
      if (greeting[0] !== 0x05) { socket.end(); return; }
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (req) => {
        const atyp = req[3];
        let host; let port;
        if (atyp === 0x01) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; port = req.readUInt16BE(8); }
        else if (atyp === 0x03) { const len = req[4]; host = req.subarray(5, 5 + len).toString('utf8'); port = req.readUInt16BE(5 + len); }
        else { socket.end(); return; }
        connections.push({ host, port });
        const upstream = netConnect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { upstream.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, connections, async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); } };
}

async function paginaPer(app, url, timeout = 20_000) {
  const fine = Date.now() + timeout;
  while (Date.now() < fine) {
    const cand = app.windows().filter((w) => { try { return !w.isClosed() && w.url() === url; } catch (_) { return false; } });
    for (const p of cand.reverse()) {
      try {
        await p.waitForFunction(() => window.__frames && window.__frames.length >= 2, null, { timeout: 3000 });
        return p;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('nessuna pagina viva per ' + url);
}

async function leggi(page) {
  return page.evaluate(() => ({
    head: document.documentElement.dataset.gpc,
    frames: window.__frames.map((f) => `${f.o.includes('localhost') ? 'altro-sito' : 'stesso-sito'}=${f.gpc}`).sort(),
  }));
}

function gpcDi(srv, tag) {
  return srv.richieste.filter((r) => r.path === '/p' || r.path === '/f').filter((r) => true);
}

async function armaTracker(app, filtro) {
  await app.evaluate(({ BrowserWindow, session }, f) => {
    globalThis.__trk = globalThis.__trk || {};
    for (const w of BrowserWindow.getAllWindows()) {
      const tm = w._filoTabs; if (!tm) continue;
      for (const t of tm.tabs) {
        if (!t.url || !t.url.includes(f)) continue;
        const ses = t.view.webContents.session;
        globalThis.__trk[f] = null;
        ses.webRequest.onErrorOccurred({ urls: ['*://*.google-analytics.com/*'] }, (d) => { if (!globalThis.__trk[f]) globalThis.__trk[f] = d.error; });
      }
    }
  }, filtro);
}

test('scheda normale, incognito e proxata: GPC in head, negli iframe e nell\'header; tracker bloccato', async ({ app, shell, openTab }) => {
  test.setTimeout(180_000);
  const srv = await serverGpc();
  const socks = await startSocks5();
  const esiti = {};
  try {
    // ── normale ──
    const uN = `http://127.0.0.1:${srv.port}/p?t=N`;
    await openTab(uN);
    const pN = await paginaPer(app, uN);
    esiti.normale = await leggi(pN);
    await armaTracker(app, 't=N');
    await pN.evaluate(() => { const i = new Image(); i.src = 'https://www.google-analytics.com/collect?n=' + Date.now(); document.body.appendChild(i); });

    // ── incognito ──
    await shell.evaluate(() => window.filoShell.openIncognito());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoTabs && w._filoTabs.incognito))).toBe(true);
    const uI = `http://127.0.0.1:${srv.port}/p?t=I`;
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.incognito);
      w._filoTabs.openTab(u);
    }, uI);
    const pI = await paginaPer(app, uI);
    esiti.incognito = await leggi(pI);
    esiti.incognitoPartition = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.incognito);
      const t = w._filoTabs.tabs.find((x) => /t=I/.test(x.url || ''));
      return t && t.view.webContents.session.storagePath === null ? 'effimera' : 'persistente';
    });
    await armaTracker(app, 't=I');
    await pI.evaluate(() => { const i = new Image(); i.src = 'https://www.google-analytics.com/collect?i=' + Date.now(); document.body.appendChild(i); });

    // ── proxata ──
    await app.evaluate(async (_e, ep) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: ep, bypass: '<-loopback>' } });
    }, `socks5://127.0.0.1:${socks.port}`);
    const uP = `http://127.0.0.1:${srv.port}/p?t=P`;
    await openTab(uP);
    await paginaPer(app, uP);
    const res = await app.evaluate(async ({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        const tm = w._filoTabs; if (!tm || tm.incognito) continue;
        const t = tm.tabs.find((x) => /t=P/.test(x.url || ''));
        if (t) return tm.setTabProxy(t.id, 'US');
      }
      return null;
    });
    expect(res && res.ok).toBe(true);
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const pP = await paginaPer(app, uP);
    esiti.proxata = await leggi(pP);
    await armaTracker(app, 't=P');
    await pP.evaluate(() => { const i = new Image(); i.src = 'https://www.google-analytics.com/collect?p=' + Date.now(); document.body.appendChild(i); });

    await new Promise((r) => setTimeout(r, 2500));
    esiti.tracker = await app.evaluate(() => globalThis.__trk);
    esiti.header = srv.richieste.map((r) => `${r.host.startsWith('localhost') ? 'L' : 'I'} ${r.path} ${r.gpc}`);
    console.log('ESITI', JSON.stringify(esiti));
    for (const r of srv.richieste) if (!r.gpc) console.log('NULLREQ', r.path, r.h);
    esiti.viaProxy = socks.connections.map((c) => `${c.host}:${c.port}`);
    console.log(JSON.stringify(esiti, null, 1));
  } finally {
    await socks.close();
    await srv.close();
  }
  const atteso = { head: 'true', frames: ['altro-sito=true', 'stesso-sito=true'] };
  expect(esiti.normale).toEqual(atteso);
  expect(esiti.incognito).toEqual(atteso);
  expect(esiti.proxata).toEqual(atteso);
  expect(esiti.tracker).toEqual({ 't=N': 'net::ERR_BLOCKED_BY_CLIENT', 't=I': 'net::ERR_BLOCKED_BY_CLIENT', 't=P': 'net::ERR_BLOCKED_BY_CLIENT' });
  expect(esiti.header.filter((h) => !h.endsWith(' 1'))).toEqual([]);
});
