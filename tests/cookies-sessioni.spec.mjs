// #753 — ogni sessione di Filo nasce protetta: scheda normale, finestra in
// incognito e scheda aperta da un altro paese ricevono lo stesso GPC (header e
// proprietà letta da uno script in <head>, anche nei riquadri) e lo stesso blocco
// dei tracker. Prima incognito e proxy nascevano senza niente.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

// Pagina con script in <head> e due riquadri che rispondono a loro volta dal
// loro <head>: uno della stessa origine, uno di un altro sito (processo a sé).
async function apriServer() {
  const richieste = [];
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    richieste.push({ path: u.pathname, nome: u.searchParams.get('nome') || '', gpc: req.headers['sec-gpc'] ?? null });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    if (u.pathname === '/f') {
      const nome = JSON.stringify(u.searchParams.get('nome') || '');
      res.end(`<!doctype html><html><head><script>
        parent.postMessage({ gpcRiquadro: ${nome}, valore: String(navigator.globalPrivacyControl) }, '*');
      </script></head><body>riquadro</body></html>`);
      return;
    }
    const porta = srv.address().port;
    res.end(`<!doctype html><html><head><script>
      window.__gpc = { testa: String(navigator.globalPrivacyControl), riquadri: {} };
      addEventListener('message', (e) => { if (e.data && e.data.gpcRiquadro) window.__gpc.riquadri[e.data.gpcRiquadro] = e.data.valore; });
    </script><title>GPC_SESSIONI</title></head><body>
      <p id="ok">pagina</p>
      <iframe src="/f?nome=stesso"></iframe>
      <iframe src="http://localhost:${porta}/f?nome=altro"></iframe>
    </body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    richieste,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

// SOCKS5 minimo che rimanda ogni nome a 127.0.0.1: la scheda "da un altro paese"
// passa davvero da un proxy, come in proxy-tab.spec.mjs.
async function apriSocks() {
  let passaggi = 0;
  const vivi = new Set();
  const srv = createNetServer((sock) => {
    vivi.add(sock);
    sock.on('close', () => vivi.delete(sock));
    sock.on('error', () => {});
    sock.once('data', (saluto) => {
      if (saluto[0] !== 0x05) { sock.end(); return; }
      sock.write(Buffer.from([0x05, 0x00]));
      sock.once('data', (req) => {
        if (req[0] !== 0x05 || req[1] !== 0x01) { sock.end(); return; }
        let porta = null;
        if (req[3] === 0x01) porta = req.readUInt16BE(8);
        else if (req[3] === 0x03) porta = req.readUInt16BE(5 + req[4]);
        else { sock.end(); return; }
        passaggi++;
        const su = netConnect(porta, '127.0.0.1', () => {
          sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          sock.pipe(su);
          su.pipe(sock);
        });
        su.on('error', () => { try { sock.destroy(); } catch (_) {} });
        sock.on('close', () => { try { su.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    porta: srv.address().port,
    passaggi: () => passaggi,
    async close() {
      for (const s of vivi) { try { s.destroy(); } catch (_) {} }
      await new Promise((r) => srv.close(r));
    },
  };
}

// La view di una scheda ricreata (proxy) lascia in app.windows() l'handle morto:
// si prova ogni candidato, dal più recente.
async function paginaCon(app, prova, tetto = 20_000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const cand = app.windows().filter((w) => { try { return !w.isClosed() && prova(w.url()); } catch (_) { return false; } });
    for (const p of cand.reverse()) {
      try {
        await p.waitForFunction(() => window.__gpc && Object.keys(window.__gpc.riquadri).length === 2, null, { timeout: 2_000 });
        return p;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina con i due riquadri non trovata');
}

const letturaGpc = (page) => page.evaluate(() => window.__gpc);

// Header visto dal server per la pagina e per i due riquadri, dopo `da`.
function headerDopo(srv, da) {
  const r = srv.richieste.slice(da);
  const di = (path, nome) => {
    const x = r.find((q) => q.path === path && q.nome === nome);
    return x ? x.gpc : 'mai arrivata';
  };
  return { pagina: di('/p', ''), stesso: di('/f', 'stesso'), altro: di('/f', 'altro') };
}

// Il blocco dei tracker si osserva sulla sessione della scheda: Chromium chiude
// la richiesta con ERR_BLOCKED_BY_CLIENT prima di qualsiasi I/O di rete.
async function trackerBloccato(app, page, trovaSessione) {
  await app.evaluate(({ BrowserWindow, session }, chi) => {
    let ses = null;
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      if (chi.incognito && !w._filoIncognito) continue;
      for (const t of w._filoTabs.tabs) {
        if (chi.proxy ? t.proxy : /^https?:/.test(t.url || '')) ses = t.view.webContents.session;
      }
    }
    globalThis.__filoErrTracker = null;
    (ses || session.defaultSession).webRequest.onErrorOccurred(
      { urls: ['*://*.google-analytics.com/*'] },
      (d) => { if (globalThis.__filoErrTracker === null) globalThis.__filoErrTracker = d.error; },
    );
  }, trovaSessione);
  await page.evaluate(() => {
    const img = new Image();
    img.src = 'https://www.google-analytics.com/collect?v=1&_t=' + Date.now();
    document.body.appendChild(img);
  });
  await expect.poll(() => app.evaluate(() => globalThis.__filoErrTracker), { timeout: 6_000 }).toBe('net::ERR_BLOCKED_BY_CLIENT');
}

async function modalita(openTab, valore) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${valore}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function apriIncognito(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs)), { timeout: 15_000 }).toBe(true);
}

const apriInIncognito = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u);
}, url);

function attesoProtetto(gpc, header) {
  expect(gpc.testa, 'script in <head> della pagina').toBe('true');
  expect(gpc.riquadri.stesso, 'riquadro della stessa origine').toBe('true');
  expect(gpc.riquadri.altro, 'riquadro di un altro sito').toBe('true');
  expect(header).toEqual({ pagina: '1', stesso: '1', altro: '1' });
}

test('scheda normale: GPC già in <head> e nei riquadri, header su pagina e riquadri', async ({ app, openTab }) => {
  const srv = await apriServer();
  try {
    await openTab(srv.base + '/p');
    const page = await paginaCon(app, (u) => u.startsWith(srv.base + '/p'));
    attesoProtetto(await letturaGpc(page), headerDopo(srv, 0));
  } finally { await srv.close(); }
});

test('incognito: nasce protetta come la finestra normale, tracker compresi', async ({ app, shell }) => {
  test.setTimeout(90_000);
  const srv = await apriServer();
  try {
    await apriIncognito(app, shell);
    await apriInIncognito(app, srv.base + '/p');
    const page = await paginaCon(app, (u) => u.startsWith(srv.base + '/p'));
    const info = await app.evaluate(({ BrowserWindow, session }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
      const ses = t.view.webContents.session;
      return { separata: ses !== session.defaultSession, nata: globalThis.__filoSessioni.eNata(ses) };
    });
    expect(info).toEqual({ separata: true, nata: true });
    attesoProtetto(await letturaGpc(page), headerDopo(srv, 0));
    await trackerBloccato(app, page, { incognito: true });
  } finally { await srv.close(); }
});

test('scheda da un altro paese: la sessione proxata nasce protetta, tracker compresi', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  const socks = await apriSocks();
  try {
    await openTab(srv.base + '/p');
    await paginaCon(app, (u) => u.startsWith(srv.base + '/p'));
    await app.evaluate(async (_e, endpoint) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: endpoint, bypass: '<-loopback>' } });
    }, `socks5://127.0.0.1:${socks.porta}`);
    const da = srv.richieste.length;
    const res = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
      return w._filoTabs.setTabProxy(t.id, 'US');
    });
    expect(res && res.ok).toBe(true);
    await expect.poll(() => srv.richieste.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(da + 3);
    const page = await paginaCon(app, (u) => u.startsWith(srv.base + '/p'));
    const info = await app.evaluate(({ BrowserWindow, session }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.proxy);
      const ses = t.view.webContents.session;
      return { partizione: t.partition, separata: ses !== session.defaultSession, nata: globalThis.__filoSessioni.eNata(ses) };
    });
    expect(info.partizione).toMatch(/^proxy:/);
    expect(info.separata).toBe(true);
    expect(info.nata).toBe(true);
    expect(socks.passaggi()).toBeGreaterThan(0);
    attesoProtetto(await letturaGpc(page), headerDopo(srv, da));
    await trackerBloccato(app, page, { proxy: true });
  } finally {
    await socks.close();
    await srv.close();
  }
});

test('privacy: il jar isolato del sito nasce protetto anche lui', async ({ app, openTab }) => {
  await modalita(openTab, 'privacy');
  const srv = await apriServer();
  try {
    await openTab(srv.base + '/p');
    const page = await paginaCon(app, (u) => u.startsWith(srv.base + '/p'));
    const partizione = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''))?.partition || null;
    });
    expect(partizione).toMatch(/^filo-priv-/);
    attesoProtetto(await letturaGpc(page), headerDopo(srv, 0));
    await trackerBloccato(app, page, {});
  } finally { await srv.close(); }
});

// La modalità si sceglie con l'incognito già aperto: anche la sua sessione, nata
// prima, deve seguirla. In Manuale niente GPC, nemmeno nei riquadri.
test('manuale: spegne GPC anche nelle sessioni già nate, riquadri compresi (controprova)', async ({ app, openTab, shell }) => {
  test.setTimeout(90_000);
  await apriIncognito(app, shell);
  await modalita(openTab, 'manual');
  const srv = await apriServer();
  try {
    await openTab(srv.base + '/p?finestra=normale');
    const normale = await paginaCon(app, (u) => u.startsWith(srv.base + '/p?finestra=normale'));
    await apriInIncognito(app, srv.base + '/p?finestra=incognito');
    const incognito = await paginaCon(app, (u) => u.startsWith(srv.base + '/p?finestra=incognito'));
    const spento = { testa: 'undefined', riquadri: { stesso: 'undefined', altro: 'undefined' } };
    expect(await letturaGpc(normale)).toEqual(spento);
    expect(await letturaGpc(incognito)).toEqual(spento);
    expect(srv.richieste.filter((r) => r.gpc !== null)).toEqual([]);
    expect(srv.richieste.length).toBeGreaterThanOrEqual(6);
  } finally { await srv.close(); }
});
