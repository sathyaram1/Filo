// Proxy per-tab — infrastruttura "Apri da un altro paese" (#147, spec in
// proxy-per-tab-spec.md). I test usano un SOCKS5 locale come provider di test
// (l'astrazione ProxyProvider è pensata per questo: endpoint configurabile,
// nessun provider commerciale integrato) e asseriscono il COMPORTAMENTO:
//
//   - setTabProxy instrada il traffico della tab attraverso l'endpoint e la
//     pagina si carica DAVVERO attraverso il proxy (non solo "nessun errore");
//   - la risoluzione DNS avviene lato proxy (semantica socks5h): un hostname
//     IRRISOLVIBILE in locale si carica lo stesso, e il proxy riceve il nome
//     di dominio, mai un IP risolto localmente;
//   - anti-leak WebRTC: la tab proxata ha policy disable_non_proxied_udp;
//   - isolamento: la tab proxata vive in una partition effimera dedicata
//     proxy:<tabId> con cookie jar separato (i cookie della sessione normale
//     non la seguono);
//   - clearTabProxy riporta la tab alla connessione diretta e al cookie jar
//     normale;
//   - senza endpoint configurato setTabProxy rifiuta con not_configured e la
//     tab resta intatta (controprova);
//   - tier 'residential' usa l'endpoint residenziale, non quello datacenter.

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

// Mini server SOCKS5 (no-auth) per i test: registra ogni CONNECT ricevuta
// (tipo di indirizzo + host + porta) e instrada verso `target` — di default
// l'host richiesto, ma può rimappare qualsiasi hostname su 127.0.0.1 per
// dimostrare la risoluzione DNS lato proxy.
async function startSocks5({ mapHostTo = null } = {}) {
  const connections = [];
  const server = createNetServer((socket) => {
    socket.on('error', () => {});
    socket.once('data', (greeting) => {
      if (greeting[0] !== 0x05) { socket.end(); return; }
      socket.write(Buffer.from([0x05, 0x00])); // method: no-auth
      socket.once('data', (req) => {
        if (req[0] !== 0x05 || req[1] !== 0x01) { socket.end(); return; }
        const atyp = req[3];
        let host = null;
        let port = null;
        if (atyp === 0x01) { // IPv4 letterale (DNS risolto dal client = leak)
          host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
          port = req.readUInt16BE(8);
        } else if (atyp === 0x03) { // domain name (DNS lato proxy = corretto)
          const len = req[4];
          host = req.subarray(5, 5 + len).toString('utf8');
          port = req.readUInt16BE(5 + len);
        } else { socket.end(); return; }
        connections.push({ atyp: atyp === 0x03 ? 'domain' : 'ipv4', host, port });
        const targetHost = (mapHostTo && atyp === 0x03) ? mapHostTo : host;
        const upstream = netConnect(port, targetHost, () => {
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
  return {
    port: server.address().port,
    connections,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// Stato (id, partition, proxy, session, policy WebRTC) della prima tab web,
// letto nel main process via app.evaluate.
async function webTabInfo(app) {
  return app.evaluate(({ BrowserWindow, session }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        if (!/^https?:/.test(t.url || '')) continue;
        let policy = null;
        try { policy = t.view.webContents.getWebRTCIPHandlingPolicy(); } catch (_) {}
        return {
          id: t.id,
          url: t.url,
          partition: t.partition || null,
          proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null,
          isDefaultSession: t.view.webContents.session === session.defaultSession,
          webrtcPolicy: policy,
        };
      }
    }
    return null;
  });
}

// Ritrova la Page Playwright della tab e aspetta che `selector` sia visibile.
// La view viene RICREATA da setTabProxy/clearTabProxy, quindi app.windows()
// può contenere ancora l'handle MORTO della vecchia view accanto a quello
// nuovo: proviamo ogni candidato finché uno risponde davvero.
async function waitPageWith(app, predicate, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    const candidates = app.windows().filter((w) => {
      try { return !w.isClosed() && predicate(w.url()); } catch (_) { return false; }
    });
    for (const p of candidates.reverse()) { // la view ricreata è la più recente
      try {
        await p.waitForSelector(selector, { timeout: 2_000 });
        return p;
      } catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`waitPageWith: nessuna window viva con ${selector} — ${lastErr?.message || 'nessun candidato'}`);
}

test('setTabProxy instrada la tab via SOCKS5 con DNS lato proxy; clearTabProxy torna diretto', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  // Il SOCKS di test rimappa qualsiasi hostname su 127.0.0.1: se una pagina su
  // un hostname inesistente si carica, la risoluzione è avvenuta LATO PROXY.
  const socks = await startSocks5({ mapHostTo: '127.0.0.1' });
  try {
    // Pagina servita dal testServer locale; cookie nella sessione NORMALE per
    // poi dimostrare che la partition proxata non lo vede.
    const url = testServer.html('<title>PROXY_T1</title><h1 id="ok">contenuto</h1><script>document.cookie="direct=1"</script>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    expect(socks.connections.length).toBe(0); // pre-condizione: niente proxy

    // Configura il provider di test (impostazioni; '<-loopback>' forza anche
    // 127.0.0.1 attraverso il proxy, che Chromium altrimenti bypassa).
    await app.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
    }, { endpoint: `socks5://127.0.0.1:${socks.port}` });

    const before = await webTabInfo(app);
    expect(before.proxy).toBeNull();
    expect(before.isDefaultSession).toBe(true);

    // ── setTabProxy: la tab viene ricreata nella partition proxata ──
    const res = await app.evaluate(async ({ BrowserWindow }, tabId) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (w._filoTabs?.tabs.some((t) => t.id === tabId)) {
          return w._filoTabs.setTabProxy(tabId, 'US');
        }
      }
      return null;
    }, before.id);
    expect(res).toEqual({ ok: true, country: 'us', tier: 'datacenter' });

    // La pagina si ricarica ATTRAVERSO il proxy: il SOCKS vede la connessione
    // e il contenuto è davvero visibile nella nuova view.
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const proxiedPage = await waitPageWith(app, (u) => u === url, '#ok');

    const info = await webTabInfo(app);
    expect(info.proxy).toEqual({ country: 'us', tier: 'datacenter' });
    expect(info.partition).toBe(`proxy:${before.id}`);
    expect(info.partition.startsWith('persist:')).toBe(false); // effimera
    expect(info.isDefaultSession).toBe(false); // cookie jar separato
    // Anti-leak WebRTC: mai UDP diretto in una tab proxata.
    expect(info.webrtcPolicy).toBe('disable_non_proxied_udp');
    // Isolamento cookie: il cookie della sessione normale NON segue la tab.
    expect(await proxiedPage.evaluate(() => document.cookie)).not.toContain('direct=1');
    // Lo snapshot per la shell espone il proxy (per l'indicatore sulla tab).
    const snap = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.snapshot());
    expect(snap.tabs.find((t) => t.id === before.id).proxy).toEqual({ country: 'us', tier: 'datacenter' });

    // ── DNS lato proxy: hostname IRRISOLVIBILE in locale, pagina che si carica ──
    const fakeHostUrl = url.replace('127.0.0.1', 'geo-block-test.filo.invalid');
    await app.evaluate(({ BrowserWindow }, args) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w._filoTabs.navigate(args.tabId, args.url);
    }, { tabId: before.id, url: fakeHostUrl });
    const dnsPage = await findPage(app, (u) => u.includes('filo.invalid'));
    await dnsPage.waitForSelector('#ok', { timeout: 10_000 }); // caricata = DNS via proxy
    const domainConn = socks.connections.find((c) => c.host === 'geo-block-test.filo.invalid');
    expect(domainConn).toBeTruthy();
    expect(domainConn.atyp).toBe('domain'); // il proxy riceve il NOME, mai l'IP locale

    // ── clearTabProxy: torna in sessione normale, connessione diretta ──
    const seen = socks.connections.length;
    const clear = await app.evaluate(({ BrowserWindow }, tabId) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      return w._filoTabs.clearTabProxy(tabId);
    }, before.id);
    expect(clear).toEqual({ ok: true });
    // Naviga a una pagina nuova su 127.0.0.1: senza proxy si carica diretta.
    const directUrl = testServer.html('<title>PROXY_DIRECT</title><h1 id="back">diretto</h1>');
    await app.evaluate(({ BrowserWindow }, args) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w._filoTabs.navigate(args.tabId, args.url);
    }, { tabId: before.id, url: directUrl });
    const directPage = await findPage(app, (u) => u === directUrl);
    await directPage.waitForSelector('#back', { timeout: 10_000 });
    expect(socks.connections.length).toBe(seen); // nessun nuovo passaggio dal proxy
    const after = await webTabInfo(app);
    expect(after.proxy).toBeNull();
    expect(after.partition).toBeNull();
    expect(after.isDefaultSession).toBe(true); // cookie jar normale ripristinato
    expect(after.webrtcPolicy).toBe('default_public_interface_only');
  } finally {
    await socks.close();
  }
});

test('senza endpoint configurato setTabProxy rifiuta e la tab resta intatta', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<title>PROXY_NOCFG</title><p id="p">ok</p>');
  const page = await openTab(url);
  await page.waitForSelector('#p');
  const before = await webTabInfo(app);
  const res = await app.evaluate(async ({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.setTabProxy(tabId, 'us');
  }, before.id);
  expect(res).toEqual({ ok: false, error: 'not_configured' });
  const after = await webTabInfo(app);
  expect(after.proxy).toBeNull();
  expect(after.isDefaultSession).toBe(true);
  // La view NON è stata ricreata: la pagina è ancora lì, viva.
  expect(await page.evaluate(() => document.getElementById('p').textContent)).toBe('ok');
});

test('tier residential usa l\'endpoint residenziale (fallback configurato a parte)', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const dcSocks = await startSocks5({ mapHostTo: '127.0.0.1' });
  const resSocks = await startSocks5({ mapHostTo: '127.0.0.1' });
  try {
    const url = testServer.html('<title>PROXY_TIER</title><h1 id="ok">tier</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await app.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({
        proxy: { datacenter: cfg.dc, residential: cfg.res, bypass: '<-loopback>' },
      });
    }, { dc: `socks5://127.0.0.1:${dcSocks.port}`, res: `socks5://127.0.0.1:${resSocks.port}` });
    const before = await webTabInfo(app);
    const res = await app.evaluate(async ({ BrowserWindow }, tabId) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      return w._filoTabs.setTabProxy(tabId, 'us', { tier: 'residential' });
    }, before.id);
    expect(res).toEqual({ ok: true, country: 'us', tier: 'residential' });
    await expect.poll(() => resSocks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(dcSocks.connections.length).toBe(0); // il datacenter NON viene toccato
    const proxiedPage = await findPage(app, (u) => u === url);
    await proxiedPage.waitForSelector('#ok', { timeout: 10_000 });
  } finally {
    await dcSocks.close();
    await resSocks.close();
  }
});
