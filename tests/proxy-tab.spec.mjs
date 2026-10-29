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
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { menuDi } from './helpers/menuContestuale.mjs';
import { nelMondoDiFilo } from './helpers/confirm.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';

// Mini server SOCKS5 (no-auth) per i test: registra ogni CONNECT ricevuta
// (tipo di indirizzo + host + porta) e instrada verso `target` — di default
// l'host richiesto, ma può rimappare qualsiasi hostname su 127.0.0.1 per
// dimostrare la risoluzione DNS lato proxy.
async function startSocks5({ mapHostTo = null } = {}) {
  const connections = [];
  // Le porte locali delle connessioni che il proxy apre verso i siti: un server di prova riconosce così chi arriva dal proxy.
  const porte = new Set();
  // net.Server NON ha closeAllConnections (è di http.Server): tracciamo i
  // socket a mano, o close() resterebbe appeso sui keep-alive di Chromium.
  const live = new Set();
  const server = createNetServer((socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
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
          porte.add(upstream.localPort);
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
    porte,
    async close() {
      for (const s of live) { try { s.destroy(); } catch (_) {} }
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
    const url = testServer.html('<title>PROXY_T1</title><h1 id="ok">contenuto</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    expect(socks.connections.length).toBe(0); // pre-condizione: niente proxy
    // Cookie piazzato UNA TANTUM nella sessione NORMALE (non nell'HTML, che
    // verrà ricaricato anche nella partition proxata): serve a dimostrare che
    // il cookie jar della tab proxata è separato.
    await page.evaluate(() => { document.cookie = 'direct=1'; });

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
    await waitPageWith(app, (u) => u.includes('filo.invalid'), '#ok'); // caricata = DNS via proxy
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
    const directPage = await waitPageWith(app, (u) => u === directUrl, '#back');
    expect(socks.connections.length).toBe(seen); // nessun nuovo passaggio dal proxy
    // Tornata nel cookie jar normale: il cookie di prima è di nuovo visibile.
    expect(await directPage.evaluate(() => document.cookie)).toContain('direct=1');
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
    await waitPageWith(app, (u) => u === url, '#ok');
  } finally {
    await dcSocks.close();
    await resSocks.close();
  }
});

// ── #1272: le richieste che Filo fa PER CONTO della scheda escono come uscirebbero da lei ──────────────────────────

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Un sito raggiungibile solo per nome attraverso il SOCKS di prova (che rimappa ogni nome sul loopback): registra chi
// chiede cosa, col Referer, e se la connessione è arrivata dal proxy.
async function sitoDiProva(socks, pagine) {
  const visti = [];
  const server = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    visti.push({
      host: String(req.headers.host || '').split(':')[0],
      percorso,
      referer: String(req.headers.referer || ''),
      ua: String(req.headers['user-agent'] || ''),
      origin: String(req.headers.origin || ''),
      dalProxy: socks.porte.has(req.socket.remotePort),
    });
    const p = pagine[percorso];
    if (!p) { res.writeHead(404); res.end(); return; }
    // Il fetch del content script (porta l'Origin) il sito non lo concede: i byte li deve chiedere il main.
    if (p.tipo === 'image/png' && req.headers.origin) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'content-type': p.tipo, 'cache-control': 'no-store', ...(p.headers || {}) });
    res.end(p.corpo);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    visti,
    // Le richieste della foto senza Origin: dopo che la pagina l'ha caricata, sono quelle del main (il fetch del content
    // script porta l'Origin). Si contano sempre da dopo il caricamento.
    byteDalMain: () => visti.filter((v) => v.percorso === '/foto.png' && !v.origin),
    async close() {
      try { server.closeAllConnections(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

async function schedaDaUnAltroPaese(app, openTab, testServer, socks) {
  const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
  await avvio.waitForSelector('#avvio');
  await app.evaluate(async (_e, endpoint) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
  }, `socks5://127.0.0.1:${socks.port}`);
  const { id } = await webTabInfo(app);
  const res = await app.evaluate(({ BrowserWindow }, tabId) =>
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setTabProxy(tabId, 'US'), id);
  expect(res.ok).toBe(true);
  return id;
}

async function apriNellaScheda(app, tabId, url, { fotoCaricata = true } = {}) {
  await app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigate(a.tabId, a.url);
  }, { tabId, url });
  const page = await waitPageWith(app, (u) => u === url, '#foto');
  if (fotoCaricata) await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
  return page;
}

test('da una scheda col proxy anteprima, immagini, «Copia immagine», Aiuto e finestra nascosta passano dal proxy (#1272)', async ({ app, openTab, testServer }) => {
  test.setTimeout(180_000);
  const socks = await startSocks5({ mapHostTo: '127.0.0.1' });
  const pagine = {};
  const sito = await sitoDiProva(socks, pagine);
  const P = sito.port;
  Object.assign(pagine, {
    '/pagina': { tipo: 'text/html; charset=utf-8', corpo: `<!doctype html><html><head><title>Pagina</title></head>
      <body style="padding:24px;font:16px sans-serif">
      <h1>Pagina da un altro paese</h1>
      <img id="foto" src="http://immagini.filo.invalid:${P}/foto.png" width="160" height="160">
      <p><a id="link" href="http://link.filo.invalid:${P}/articolo">un articolo</a></p>
      <p><a id="corto" href="http://bit.ly:${P}/abc123" style="display:inline-block;padding:20px">link accorciato</a></p>
      </body></html>` },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
    '/articolo': { tipo: 'text/html; charset=utf-8', corpo: '<html><head><title>Articolo</title><meta property="og:title" content="Articolo letto dal proxy"></head><body>x</body></html>' },
    '/abc123': { tipo: 'text/html; charset=utf-8', corpo: '<html><body>accorciatore</body></html>' },
  });
  const origine = `http://pagina.filo.invalid:${P}/`;
  try {
    const tabId = await schedaDaUnAltroPaese(app, openTab, testServer, socks);
    const page = await apriNellaScheda(app, tabId, `${origine}pagina?q=ricerca-segreta&token=abc123`);

    // Tasto destro su un link: titolo e descrizione arrivano dal sito attraverso il proxy, con l'identità della scheda.
    await page.locator('#link').click({ button: 'right' });
    await expect.poll(() => sito.visti.filter((v) => v.percorso === '/articolo').length, { timeout: 15_000 }).toBeGreaterThan(0);
    const anteprima = sito.visti.find((v) => v.percorso === '/articolo');
    expect(anteprima.host).toBe('link.filo.invalid');
    expect(anteprima.ua).toMatch(/^Mozilla\//);
    expect(anteprima.referer, 'chi passa sopra un link non l\'ha ancora aperto').toBe('');
    await page.keyboard.press('Escape');

    // Tasto destro su un'immagine di un altro dominio: i byte li scarica il main, dal proxy.
    const caricata = sito.byteDalMain().length;
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    await expect.poll(() => sito.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(caricata);
    await page.keyboard.press('Escape');

    // «Copia immagine»: anche la sua copia della foto la chiede il main, dal proxy. (Che poi arrivi negli appunti non
    // si vede qui: in una pagina http lo script non ha gli appunti.)
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const copia = menuDi(page).locator('.sn-menu button', { hasText: 'Copia immagine' });
    await expect(copia).toBeVisible();
    const primaDellaCopia = sito.byteDalMain().length;
    await copia.click();
    await expect.poll(() => sito.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(primaDellaCopia);

    // Una domanda all'Aiuto: legge le immagini che si vedono e chiede l'llms.txt del sito, tutto dal proxy.
    const primaDellAiuto = sito.byteDalMain().length;
    await nelMondoDiFilo(app, 'pagina.filo.invalid', 'SN_SIDEBAR.open(); 1');
    const aiuto = await paginaDellAiuto(app, page);
    await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
    await aiuto.fill('.sn-sidebar-input textarea', 'riassumi la pagina');
    await aiuto.press('.sn-sidebar-input textarea', 'Enter');
    await expect.poll(() => socks.connections.some((c) => c.host === 'pagina.filo.invalid' && c.port === 443), {
      timeout: 15_000, message: 'l\'llms.txt dell\'Aiuto doveva partire dal proxy della scheda',
    }).toBe(true);
    await expect.poll(() => sito.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(primaDellAiuto);

    // Il puntatore fermo su un link accorciato: la finestra nascosta lo apre dallo stesso proxy.
    const box = await page.locator('#corto').boundingBox();
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await expect.poll(() => sito.visti.filter((v) => v.host === 'bit.ly').length, {
      timeout: 20_000, message: 'la finestra nascosta doveva aprire il link accorciato attraverso il proxy',
    }).toBeGreaterThan(0);
    expect(socks.connections.some((c) => c.host === 'bit.ly')).toBe(true);

    // Il sito ha visto solo richieste arrivate dal proxy, e gli altri domini nessun Referer con percorso o parametri.
    expect(sito.visti.filter((v) => !v.dalProxy)).toEqual([]);
    for (const v of sito.byteDalMain().slice(caricata)) expect(v.referer).toBe(origine);
    expect(sito.visti.filter((v) => v.host !== 'pagina.filo.invalid' && v.referer && !/^http:\/\/[^/]+\/$/.test(v.referer))).toEqual([]);
  } finally {
    await sito.close();
    await socks.close();
  }
});

test('il Referer dei byte di un\'immagine tace se la pagina lo chiede o se da https si scende a http (#1272)', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const socks = await startSocks5({ mapHostTo: '127.0.0.1' });
  const pagine = {};
  const sito = await sitoDiProva(socks, pagine);
  const P = sito.port;
  const foto = `http://immagini.filo.invalid:${P}/foto.png`;
  const corpo = (testa) => `<!doctype html><html><head>${testa}</head><body style="padding:24px">
    <img id="foto" src="${foto}" width="160" height="160"></body></html>`;
  Object.assign(pagine, {
    '/meta': { tipo: 'text/html; charset=utf-8', corpo: corpo('<meta name="referrer" content="no-referrer">') },
    '/intestazione': { tipo: 'text/html; charset=utf-8', corpo: corpo(''), headers: { 'Referrer-Policy': 'no-referrer' } },
    '/foto.png': { tipo: 'image/png', corpo: PNG },
  });
  try {
    const tabId = await schedaDaUnAltroPaese(app, openTab, testServer, socks);
    for (const percorso of ['/meta', '/intestazione']) {
      const page = await apriNellaScheda(app, tabId, `http://pagina.filo.invalid:${P}${percorso}?q=segreta`);
      const prima = sito.byteDalMain().length;
      await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
      await expect.poll(() => sito.byteDalMain().length, { timeout: 15_000 }).toBeGreaterThan(prima);
      await page.keyboard.press('Escape');
      const referer = sito.byteDalMain().slice(prima).map((r) => r.referer);
      expect(referer, `la pagina ${percorso} chiede di non dire da dove viene`).toEqual(referer.map(() => ''));
    }

    // Una pagina https, servita dentro la sessione della scheda, con l'immagine in http: Filo la chiede come la
    // chiederebbero il menu e l'Aiuto, e il sito dell'immagine non sa da dove.
    await app.evaluate(({ session }, a) => {
      session.fromPartition(`proxy:${a.tabId}`).protocol.handle('https', (req) => {
        if (new URL(req.url).hostname !== 'sicura.filo.invalid') return new Response('', { status: 404 });
        return new Response(a.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      });
    }, { tabId, html: corpo('') });
    await apriNellaScheda(app, tabId, 'https://sicura.filo.invalid/conto?numero=42', { fotoCaricata: false });
    const prima = sito.byteDalMain().length;
    const letta = await nelMondoDiFilo(app, 'sicura.filo.invalid',
      `SN_ACTIONS.scaricaImmagine(${JSON.stringify(foto)}, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)`);
    expect(letta).toBe('data:image/png;base64,');
    const richieste = sito.byteDalMain().slice(prima);
    expect(richieste.length).toBeGreaterThan(0);
    expect(richieste.map((r) => r.referer)).toEqual(richieste.map(() => ''));
    expect(richieste.every((r) => r.dalProxy)).toBe(true);
  } finally {
    await sito.close();
    await socks.close();
  }
});

// ── #1272: un fornitore col paese nel nome utente ha lo stesso indirizzo per ogni paese ─────────────────────────────
// Chromium ricorda la password del proxy per indirizzo: cambiato paese, le richieste devono uscire col nome nuovo.

const PASSWORD_PROXY = 'segreta';

// Proxy HTTP di prova: chiede la password (407) e annota con quale utente, cioè da quale paese, è uscita ogni richiesta.
async function proxyColPaeseNelNome() {
  const uscite = [];
  const live = new Set();
  const server = createHttpServer((req, res) => {
    const a = String(req.headers['proxy-authorization'] || '');
    const [utente, password] = a.startsWith('Basic ') ? Buffer.from(a.slice(6), 'base64').toString().split(':') : ['', ''];
    if (password !== PASSWORD_PROXY) { res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="prova"' }); res.end(); return; }
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); res.end(); return; }
    uscite.push({ utente, percorso: u.pathname });
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
  server.on('connection', (s) => { live.add(s); s.on('close', () => live.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    utentiPer: (percorso) => uscite.filter((x) => x.percorso === percorso).map((x) => x.utente),
    async close() { for (const s of live) { try { s.destroy(); } catch (_) {} } await new Promise((r) => server.close(r)); },
  };
}

// Pagine /pagina-<n> con un link accorciato /corto-<n>; l'accorciatore risponde una pagina qualunque.
async function sitoConLinkAccorciati() {
  const server = createHttpServer((req, res) => {
    const percorso = req.url.split('?')[0];
    const P = server.address().port;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    if (!percorso.startsWith('/pagina-')) { res.end('<html><body>accorciatore</body></html>'); return; }
    const n = percorso.slice('/pagina-'.length);
    res.end(`<!doctype html><html><head><title>Pagina ${n}</title></head><body style="padding:24px">
      <p id="pronta">pagina ${n}</p>
      <p><a id="corto" href="http://bit.ly:${P}/corto-${n}" style="display:inline-block;padding:20px">link accorciato</a></p></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, async close() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

async function conProxyColPaeseNelNome(app, openTab, testServer, proxy) {
  const avvio = await openTab(testServer.html('<title>avvio</title><p id="avvio">x</p>'));
  await avvio.waitForSelector('#avvio');
  await app.evaluate(async (_e, endpoint) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
  }, `http://utente-{country}:${PASSWORD_PROXY}@127.0.0.1:${proxy.port}`);
  return (await webTabInfo(app)).id;
}

async function inPaese(app, tabId, paese, url) {
  const r = await app.evaluate(({ BrowserWindow }, a) =>
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setTabProxy(a.tabId, a.paese), { tabId, paese });
  expect(r.ok).toBe(true);
  await app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.navigate(a.tabId, a.url);
  }, { tabId, url });
  return waitPageWith(app, (u) => u === url, '#pronta');
}

async function fermaSulLinkAccorciato(page) {
  const box = await page.locator('#corto').boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

test('la finestra nascosta di una scheda tedesca esce dalla Germania anche dopo un link visto da una scheda americana (#1272)', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  const sito = await sitoConLinkAccorciati();
  const proxy = await proxyColPaeseNelNome();
  try {
    const primaId = await conProxyColPaeseNelNome(app, openTab, testServer, proxy);
    const americana = await inPaese(app, primaId, 'US', `http://pagina.filo.invalid:${sito.port}/pagina-us`);
    await fermaSulLinkAccorciato(americana);
    await expect.poll(() => proxy.utentiPer('/corto-us'), { timeout: 20_000 }).toContain('utente-us');

    const seconda = await openTab(testServer.html('<title>seconda</title><p id="seconda">x</p>'));
    await seconda.waitForSelector('#seconda');
    const secondaId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.activeId);
    const tedesca = await inPaese(app, secondaId, 'DE', `http://pagina.filo.invalid:${sito.port}/pagina-de`);
    await fermaSulLinkAccorciato(tedesca);
    await expect.poll(() => proxy.utentiPer('/corto-de').length, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(proxy.utentiPer('/corto-de'), 'il link accorciato visto da una scheda tedesca esce dalla Germania').toEqual(['utente-de']);
  } finally {
    await sito.close();
    await proxy.close();
  }
});

test('una scheda americana portata in Germania carica dalla Germania (#1272)', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const sito = await sitoConLinkAccorciati();
  const proxy = await proxyColPaeseNelNome();
  try {
    const id = await conProxyColPaeseNelNome(app, openTab, testServer, proxy);
    await inPaese(app, id, 'US', `http://pagina.filo.invalid:${sito.port}/pagina-us`);
    expect(proxy.utentiPer('/pagina-us')).toEqual(['utente-us']);
    await inPaese(app, id, 'DE', `http://pagina.filo.invalid:${sito.port}/pagina-de`);
    expect(proxy.utentiPer('/pagina-de'), 'cambiato paese, la pagina arriva dalla Germania').toEqual(['utente-de']);
  } finally {
    await sito.close();
    await proxy.close();
  }
});
