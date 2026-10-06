// Rilevamento geo-block, livello 2: classificatore LLM (proxy-per-tab-spec.md
// §4, feedback "classificatore LLM dei blocchi ambigui"). Il test asserisce il
// COMPORTAMENTO del wiring reale in tabs.js: navigando su una pagina della coda
// AMBIGUA (HTTP 403, "non disponibile" generico) che i pattern deterministici
// del livello 1 NON risolvono, Filo interroga il classificatore e:
//
//   - se la classe è geo_block → emette il segnale interno con source
//     llm_classifier (è l'unica classe che attiva il flusso proxy);
//   - se la classe è bot_block / paywall / login_wall / errore_generico →
//     NESSUN segnale (nessuna azione proxy);
//   - su una pagina normale e piena (non ambigua) il gate evita la chiamata al
//     modello → nessun segnale.
//
// Il livello 2 parte solo con un fornitore configurato (#771; il caso senza sta
// in proxy-senza-fornitore.spec.mjs): qui c'è, quindi un geo_block fa scattare
// il nuovo tentativo attraverso il fornitore. L'endpoint è finto ma non serve:
// Chromium manda comunque diretto il traffico verso 127.0.0.1.
//
// Il modello è SIMULATO (dependency injection): sostituiamo SN_GEO_CLASSIFY con
// la stessa logica del classificatore ma con un `complete` che ritorna la
// classe decisa dal test. Così esercitiamo gate + emit reali senza rete.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

async function startServer() {
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/forbidden-geo') {
      // 403 con corpo generico: il livello 1 NON ha pattern per questo → coda L2.
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>403</title><h1 id="msg">Access denied to this resource.</h1>');
    } else if (path === '/forbidden-bot') {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>403</title><h1 id="msg">Access denied — verify you are human.</h1>');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<title>OK</title><p id="ok">' + 'Benvenuto, contenuto regolare e abbondante. '.repeat(10) + '</p>');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    // Un nome da internet (la fixture lo porta al loopback): una pagina della rete di casa non va al classificatore (#591).
    origin: `http://sito-pubblico.test:${server.address().port}`,
    async close() {
      try { server.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => server.close(r));
    },
  };
}

async function webTabGeo(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    if (!w) return null;
    const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
    if (!t) return null;
    return { id: t.id, url: t.url, geoBlock: t.geoBlock ? { ...t.geoBlock } : null, proxy: t.proxy ? { ...t.proxy } : null };
  });
}

async function navigate(app, tabId, url) {
  await app.evaluate(({ BrowserWindow }, args) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.navigate(args.tabId, args.url);
  }, { tabId, url });
}

test('geo-block livello 2: solo geo_block dalla coda ambigua emette il segnale (source llm_classifier)', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const srv = await startServer();
  try {
    await app.evaluate(async () => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } });
    });
    // Modello simulato + registro segnali, nel main process. Usiamo la VERA
    // logica del classificatore (gate, parsing, routing) ma un complete finto.
    await app.evaluate(() => {
      const Classifier = globalThis.SN_GEOBLOCK_CLASSIFIER;
      const cache = Classifier.createCache();
      globalThis.__fakeClass = 'errore_generico';
      globalThis.__modelCalls = 0;
      globalThis.SN_GEO_CLASSIFY = (input) => Classifier.classify(input, {
        complete: async () => { globalThis.__modelCalls++; return globalThis.__fakeClass; },
        cache,
      });
      globalThis.__geoSignals = [];
      globalThis.SN_GEOBLOCK.onDetected((s) => globalThis.__geoSignals.push(s));
    });
    const signals = () => app.evaluate(() => globalThis.__geoSignals);
    const modelCalls = () => app.evaluate(() => globalThis.__modelCalls);
    // NB: app.evaluate passa il modulo electron come PRIMO argomento; l'arg
    // del test è il secondo.
    const setClass = (c) => app.evaluate((_electron, cl) => { globalThis.__fakeClass = cl; }, c);

    // ── 403 ambiguo classificato bot_block → modello interrogato, NESSUN segnale ──
    await setClass('bot_block');
    const page = await openTab(`${srv.origin}/forbidden-bot`);
    await page.waitForSelector('#msg');
    await expect.poll(modelCalls, { timeout: 15_000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 3500)); // oltre il campione di testo ritardato
    let tab = await webTabGeo(app);
    expect(tab.geoBlock).toBeNull();
    expect(tab.proxy).toBeNull(); // nessuna azione proxy
    expect((await signals()).length).toBe(0);

    // ── pagina normale e piena: il gate evita del tutto la chiamata al modello ──
    const callsBefore = await modelCalls();
    await setClass('geo_block'); // anche se "direbbe" geo_block, il gate non chiama
    await navigate(app, tab.id, `${srv.origin}/ok`);
    await expect.poll(async () => (await webTabGeo(app)).url, { timeout: 10_000 }).toBe(`${srv.origin}/ok`);
    await new Promise((r) => setTimeout(r, 3500));
    tab = await webTabGeo(app);
    expect(tab.geoBlock).toBeNull();
    expect((await signals()).length).toBe(0);
    expect(await modelCalls()).toBe(callsBefore);

    // ── 403 ambiguo classificato geo_block → segnale con source llm_classifier ──
    await navigate(app, tab.id, `${srv.origin}/forbidden-geo`);
    await expect.poll(async () => (await signals()).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const sig = (await signals())[0];
    expect(sig.source).toBe('llm_classifier');
    expect(sig.detail).toBe('geo_block');
    expect(sig.host).toBe('sito-pubblico.test');
    // Col fornitore la matrice d'azione riprova da sola attraverso di lui.
    await expect.poll(async () => (await webTabGeo(app)).proxy, { timeout: 15_000 })
      .toEqual({ country: 'us', tier: 'datacenter' });
  } finally {
    await srv.close();
  }
});
