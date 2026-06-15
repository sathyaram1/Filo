// Persistenza e privacy delle tab "aperte da un altro paese" (proxy per-tab).
//
// ASSERISCE il comportamento richiesto dal feedback:
//
//   - chiudendo (= archiviando) una tab proxata, la location usata finisce nei
//     metadati dell'archivio; riaprendola dall'archivio la tab RINASCE proxata
//     sulla STESSA location (non diretta, non su un paese diverso);
//   - in incognito nulla viene archiviato, anche per le tab proxate (le regole
//     incognito esistenti valgono identiche);
//   - la pagina Sicurezza/Privacy dichiara onestamente che le tab da un altro
//     paese passano per un fornitore di rete terzo (e ne mostra l'host quando
//     un provider è configurato).
//
// Senza il fix: l'archivio non salvava la location e la tab riaperta nasceva
// diretta (la feature "riapri com'era" era monca per le tab proxate).

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

// Mini SOCKS5 (no-auth) come provider di test: serve solo perché setTabProxy
// applichi DAVVERO il proxy (resolve trova un endpoint) e la view rinasca nella
// partition proxata. Non asseriamo qui il routing (lo fa proxy-tab.spec).
async function startSocks5() {
  const live = new Set();
  const server = createNetServer((socket) => {
    live.add(socket);
    socket.on('close', () => live.delete(socket));
    socket.on('error', () => {});
    socket.once('data', (greeting) => {
      if (greeting[0] !== 0x05) { socket.end(); return; }
      socket.write(Buffer.from([0x05, 0x00]));
      socket.once('data', (req) => {
        if (req[0] !== 0x05 || req[1] !== 0x01) { socket.end(); return; }
        const atyp = req[3];
        let host = null; let port = null;
        if (atyp === 0x01) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; port = req.readUInt16BE(8); }
        else if (atyp === 0x03) { const len = req[4]; host = req.subarray(5, 5 + len).toString('utf8'); port = req.readUInt16BE(5 + len); }
        else { socket.end(); return; }
        const upstream = netConnect(port, host, () => {
          socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          socket.pipe(upstream); upstream.pipe(socket);
        });
        upstream.on('error', () => { try { socket.destroy(); } catch (_) {} });
        socket.on('close', () => { try { upstream.destroy(); } catch (_) {} });
      });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    async close() {
      for (const s of live) { try { s.destroy(); } catch (_) {} }
      await new Promise((r) => server.close(r));
    },
  };
}

const PAGE = `<!doctype html><html><head><title>Sito Proxato</title></head>
  <body style="margin:0"><div id="p" style="height:800px">ok</div></body></html>`;

test('archivia una tab proxata e la riapre proxata sulla stessa location', async ({ app, shell, openTab, testServer }) => {
  const socks = await startSocks5();
  try {
    const page = await testServer.openReady(openTab, PAGE);
    const url = page.url();

    // Configura un provider proxy di test (endpoint SOCKS5 locale).
    await app.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
    }, { endpoint: `socks5://127.0.0.1:${socks.port}` });

    // Id della tab web corrente.
    const tabId = await shell.evaluate(async () => {
      const snap = await window.filoShell.tabs.snapshot();
      return snap.tabs.find((t) => /^https?:/.test(t.url || '')).id;
    });

    // Apri la tab "dagli USA": setTabProxy ricrea la view proxata.
    const res = await app.evaluate(async ({ BrowserWindow }, id) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      return w._filoTabs.setTabProxy(id, 'us');
    }, tabId);
    expect(res.ok).toBe(true);
    expect(res.country).toBe('us');

    // Chiudi la tab → viene archiviata con la location proxy nei metadati.
    await shell.evaluate(async (id) => window.filoShell.tabs.close(id), tabId);

    // L'entry archiviata ha la location proxy salvata.
    await expect.poll(async () => app.evaluate(async () => {
      const items = await globalThis.SN_ARCHIVED_TABS.list();
      const e = items.find((x) => /Sito Proxato|127\.0\.0\.1/.test(`${x.title} ${x.url}`));
      return e && e.proxy ? e.proxy.country : null;
    }), { timeout: 8_000 }).toBe('us');

    // Riapri dall'archivio: la pagina archivio mostra la riga e il pulsante
    // "Riapri" manda anche la location proxy all'handler.
    const archive = await openTab('filo://archive/archive.html');
    await archive.waitForLoadState('domcontentloaded');
    const row = archive.locator('.arc-tab', { hasText: 'Sito Proxato' });
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.getByText('Riapri').click();

    // La tab riaperta NASCE proxata sulla stessa location (us), non diretta.
    await expect.poll(async () => app.evaluate(({ BrowserWindow }, target) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => (x.url || '') === target && x.proxy);
      return t ? `${t.proxy.country}|${t.partition}` : null;
    }, url), { timeout: 12_000 }).toMatch(/^us\|proxy:/);
  } finally {
    await socks.close();
  }
});

test('in incognito una tab proxata non viene archiviata', async ({ app }) => {
  // Verifica la regola incognito direttamente sul TabManager: _archiveClosedTab
  // su un manager incognito non deve scrivere nulla nello store, nemmeno per una
  // tab con proxy. Usiamo un manager fittizio (incognito=true) senza toccare la
  // finestra reale, e contiamo le entry prima/dopo.
  const result = await app.evaluate(async ({ BrowserWindow }) => {
    const before = (await globalThis.SN_ARCHIVED_TABS.list()).length;
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const mgr = w._filoTabs;
    const wasIncognito = mgr.incognito;
    mgr.incognito = true; // simula manager incognito
    try {
      mgr._archiveClosedTab({
        id: 'fake-incognito-tab',
        url: 'https://example.com/secret',
        title: 'Segreto',
        proxy: { country: 'us', tier: 'datacenter' },
      });
    } finally {
      mgr.incognito = wasIncognito;
    }
    // dà tempo all'archiviazione async (best-effort) di NON scrivere
    await new Promise((r) => setTimeout(r, 300));
    const after = (await globalThis.SN_ARCHIVED_TABS.list()).length;
    return { before, after };
  });
  expect(result.after).toBe(result.before);
});

test('la pagina Privacy dichiara il passaggio da un fornitore terzo e ne mostra l\'host', async ({ app, openTab }) => {
  // Con un provider configurato, la riga privacy mostra l'host del fornitore.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://user-{country}:pw@gate.testprovider.net:7000' } });
  });
  const sec = await openTab('filo://security/security.html');
  await sec.waitForLoadState('domcontentloaded');

  const box = sec.locator('#sec-proxy-box');
  await expect(box).toBeVisible({ timeout: 8_000 });
  // Dichiarazione onesta: traffico via fornitore di rete terzo.
  await expect(sec.locator('#sec-proxy-box-body')).toContainText(/fornitore di rete terzo/i);
  // Host del provider configurato, mostrato per onestà.
  const provider = sec.locator('#sec-proxy-box-provider');
  await expect(provider).toBeVisible();
  await expect(provider).toContainText('gate.testprovider.net');
});
