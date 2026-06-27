// Regole d'azione su geo-block rilevato — livello decisionale (#151,
// proxy-per-tab-spec.md §5). Qui si asserisce il COMPORTAMENTO dei due flussi
// principali del "criterio di fatto" del feedback:
//
//   (a) retry silenzioso con toast: sito non flaggato + nessun cookie di login
//       → la tab viene riaperta proxata DA SOLA e la shell mostra "Aperto da …";
//   (b) proposta inline con login attivo: cookie di sessione presenti → MAI retry
//       silenzioso, compare la striscia che propone l'apertura da un altro paese;
//       accettando, la tab viene proxata.
//
// Più la guardia di sicurezza (c): sito flaggato pericoloso → nessuna azione.
//
// Il segnale di geo-block viene iniettato chiamando _geoBlockDetected (il punto
// d'ingresso che il rilevamento, già testato in tests/unit/geoBlock.test.mjs,
// usa internamente): così il test è deterministico e mirato al LIVELLO
// DECISIONALE, con input reali (proxy SOCKS5 di test, cookie reali nella session,
// toast reale nella shell, banner reale nel content script).

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

// Mini SOCKS5 (no-auth) che registra le CONNECT e rimappa ogni hostname su
// 127.0.0.1 (così una pagina caricata davvero dimostra il passaggio dal proxy).
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
        if (req[0] !== 0x05 || req[1] !== 0x01) { socket.end(); return; }
        const atyp = req[3];
        let host = null; let port = null;
        if (atyp === 0x01) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; port = req.readUInt16BE(8); }
        else if (atyp === 0x03) { const len = req[4]; host = req.subarray(5, 5 + len).toString('utf8'); port = req.readUInt16BE(5 + len); }
        else { socket.end(); return; }
        connections.push({ host, port });
        const upstream = netConnect(port, '127.0.0.1', () => {
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
    connections,
    async close() {
      for (const s of live) { try { s.destroy(); } catch (_) {} }
      await new Promise((r) => server.close(r));
    },
  };
}

// id + stato proxy della prima tab web.
async function webTab(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        if (!/^https?:/.test(t.url || '')) continue;
        return { id: t.id, url: t.url, proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null };
      }
    }
    return null;
  });
}

// Inietta il segnale "geo-block rilevato" sul tab (come fa il rilevamento).
async function fireGeoBlock(app, tabId) {
  return app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tab = w._filoTabs.tabs.find((t) => t.id === id);
    w._filoTabs._geoBlockDetected(tab, tab.url, 'http_451', 'http_451');
    return true;
  }, tabId);
}

async function configureProxy(app, port) {
  // '<-loopback>' forza anche 127.0.0.1 attraverso il proxy (Chromium lo bypassa
  // di default).
  await app.evaluate(async (_e, cfg) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
  }, { endpoint: `socks5://127.0.0.1:${port}` });
}

test('(a) sito non flaggato senza login → retry silenzioso e toast "Aperto da …"', async ({ app, openTab, shell, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>GEO_A</title><h1 id="ok">contenuto</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProxy(app, socks.port);

    const before = await webTab(app);
    expect(before.proxy).toBeNull();
    expect(socks.connections.length).toBe(0); // pre-condizione: nessun proxy

    await fireGeoBlock(app, before.id);

    // La tab viene riaperta proxata DA SOLA, e il traffico passa dal proxy.
    await expect.poll(async () => (await webTab(app)).proxy, { timeout: 30_000 })
      .toEqual({ country: 'us', tier: 'datacenter' });
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);

    // Toast discreto nella shell: informa, non chiede.
    const toast = shell.locator('.shell-notif.show .shell-notif-msg');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toHaveText('Aperto da Stati Uniti');
  } finally {
    await socks.close();
  }
});

test('(b) login attivo → niente retry silenzioso, proposta inline; accettando si proxa', async ({ app, openTab, shell, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>GEO_B</title><h1 id="ok">contenuto</h1>');
    // openReady: aspetta che i content script (incluso geoProposal.js) siano montati.
    const page = await testServer.openReady(openTab, '<title>GEO_B</title><h1 id="ok">contenuto</h1>');
    await page.waitForSelector('#ok');
    // Sessione di login attiva per il dominio.
    await page.evaluate(() => { document.cookie = 'sessionid=abc123; path=/'; });
    await configureProxy(app, socks.port);

    const before = await webTab(app);
    await fireGeoBlock(app, before.id);

    // Compare la proposta inline (banner del content script, Shadow DOM aperto).
    const openBtn = page.getByText('Apri da Stati Uniti', { exact: true });
    await expect(openBtn).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('In questa tab non sarai loggato.', { exact: false })).toBeVisible();

    // Invariante forte (b): a sessione attiva NON si riprova mai in silenzio.
    expect((await webTab(app)).proxy).toBeNull();
    expect(socks.connections.length).toBe(0);

    // Accettando la proposta, la tab viene instradata dall'altro paese.
    await openBtn.click();
    await expect.poll(async () => (await webTab(app)).proxy, { timeout: 30_000 })
      .toEqual({ country: 'us', tier: 'datacenter' });
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    await socks.close();
  }
});

test('(c) sito flaggato pericoloso → nessuna azione (il proxy non aggira la sicurezza)', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>GEO_C</title><h1 id="ok">contenuto</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProxy(app, socks.port);

    const before = await webTab(app);
    // Simula un verdetto di sicurezza attivo sul tab.
    await app.evaluate(({ BrowserWindow }, id) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const tab = w._filoTabs.tabs.find((t) => t.id === id);
      tab.sbLevel = 'pericoloso';
    }, before.id);

    await fireGeoBlock(app, before.id);

    // Nessun retry, nessuna proposta: il proxy non deve mai aggirare i controlli.
    await page.waitForTimeout(1500);
    expect((await webTab(app)).proxy).toBeNull();
    expect(socks.connections.length).toBe(0);
    // Nessun banner di proposta nel content script.
    expect(await page.locator('#filo-geoproposal-host').count()).toBe(0);
  } finally {
    await socks.close();
  }
});
