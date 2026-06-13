// Rilevamento geo-block, livello 1 deterministico (#149, proxy-per-tab-spec.md
// §4). Il test asserisce il COMPORTAMENTO: navigando su contenuto geo-bloccato
// il segnale interno "geo-block rilevato per la tab X" viene emesso (con
// dominio e fonte), e NESSUNA azione viene presa (questo livello rileva, non
// agisce: niente retry via proxy, niente UI — le regole d'azione sono un
// livello separato).
//
//   - HTTP 451 → segnale con source http_451 (conclusivo);
//   - redirect verso /geo-blocked → segnale con source redirect_pattern;
//   - pagina 200 col messaggio esplicito di YouTube → source text_pattern;
//   - pagina normale / "video rimosso" (ambiguo) → NESSUN segnale (la coda
//     ambigua appartiene al classificatore LLM, livello 2, feedback separato).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// Server locale con controllo completo di status/redirect (il testServer del
// fixture serve solo 200).
async function startGeoServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/451') {
      res.writeHead(451, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>GEO_451</title><h1 id="blocked">Unavailable For Legal Reasons</h1>');
    } else if (path === '/redir') {
      res.writeHead(302, { Location: '/geo-blocked' });
      res.end();
    } else if (path === '/geo-blocked') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>GEO_REDIR</title><h1 id="landing">Questo contenuto non è disponibile qui</h1>');
    } else if (path === '/yt') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>GEO_YT</title><div id="player">Video unavailable<br>The uploader has not made this video available in your country</div>');
    } else if (path === '/removed') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>GEO_REMOVED</title><p id="msg">This video has been removed by the uploader.</p>');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>GEO_OK</title><p id="ok">tutto regolare</p>');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

// Stato geo-block della prima tab web, letto nel main process.
async function webTabGeo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (!w) return null;
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    if (!t) return null;
    return {
      id: t.id,
      url: t.url,
      geoBlock: t.geoBlock ? { ...t.geoBlock } : null,
      proxy: t.proxy ? { ...t.proxy } : null,
    };
  });
}

async function navigate(app, tabId, url) {
  await app.evaluate(({ BrowserWindow }, args) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.navigate(args.tabId, args.url);
  }, { tabId, url });
}

test('geo-block livello 1: 451/redirect/testo emettono il segnale, i casi ambigui no', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const srv = await startGeoServer();
  try {
    // Registra un ascoltatore del segnale interno PRIMA di navigare: è il
    // contratto che il livello decisionale (feedback separato) userà.
    await app.evaluate(() => {
      globalThis.__geoSignals = [];
      globalThis.SN_GEOBLOCK.onDetected((s) => globalThis.__geoSignals.push(s));
    });
    const signals = () => app.evaluate(() => globalThis.__geoSignals);

    // ── HTTP 451: geo-block per definizione, conclusivo ──
    const page = await openTab(`${srv.origin}/451`);
    await page.waitForSelector('#blocked');
    await expect.poll(async () => (await signals()).length, { timeout: 10_000 }).toBeGreaterThan(0);
    let sig = (await signals())[0];
    expect(sig.source).toBe('http_451');
    expect(sig.host).toBe('127.0.0.1');
    expect(sig.url).toBe(`${srv.origin}/451`);
    let tab = await webTabGeo(app);
    expect(sig.tabId).toBe(tab.id);
    expect(tab.geoBlock.source).toBe('http_451');
    // RILEVA, NON AGISCE: nessun retry via proxy è partito.
    expect(tab.proxy).toBeNull();

    // ── pagina normale: il segnale decade, nessun nuovo segnale ──
    await navigate(app, tab.id, `${srv.origin}/ok`);
    await expect.poll(async () => (await webTabGeo(app)).url, { timeout: 10_000 }).toBe(`${srv.origin}/ok`);
    // aspetta anche il campione di testo ritardato (2s) prima di asserire
    await new Promise((r) => setTimeout(r, 3000));
    tab = await webTabGeo(app);
    expect(tab.geoBlock).toBeNull();
    expect((await signals()).length).toBe(1);

    // ── redirect verso URL "di blocco" (/geo-blocked) ──
    await navigate(app, tab.id, `${srv.origin}/redir`);
    await expect.poll(async () => (await signals()).length, { timeout: 10_000 }).toBe(2);
    sig = (await signals())[1];
    expect(sig.source).toBe('redirect_pattern');
    expect(sig.host).toBe('127.0.0.1');
    tab = await webTabGeo(app);
    expect(tab.geoBlock.source).toBe('redirect_pattern');
    expect(tab.proxy).toBeNull();

    // ── pattern di testo esplicito (messaggio YouTube) su una 200 ──
    await navigate(app, tab.id, `${srv.origin}/yt`);
    await expect.poll(async () => (await signals()).length, { timeout: 15_000 }).toBe(3);
    sig = (await signals())[2];
    expect(sig.source).toBe('text_pattern');
    expect(sig.detail).toBe('yt_uploader_country');
    expect(tab.proxy).toBeNull();

    // ── caso ambiguo ("video rimosso"): NESSUN segnale deterministico ──
    await navigate(app, tab.id, `${srv.origin}/removed`);
    await expect.poll(async () => (await webTabGeo(app)).url, { timeout: 10_000 }).toBe(`${srv.origin}/removed`);
    await new Promise((r) => setTimeout(r, 3000)); // oltre il campione ritardato
    tab = await webTabGeo(app);
    expect(tab.geoBlock).toBeNull();
    expect((await signals()).length).toBe(3);
  } finally {
    await srv.close();
  }
});
