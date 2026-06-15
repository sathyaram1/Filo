// Proxy per-tab — linguaggio naturale + istruzioni persistenti per dominio
// (#152, spec in proxy-per-tab-spec.md §3 "Linguaggio naturale" e §2.3
// "Istruzioni persistenti"). Costruisce sopra l'infrastruttura proxy per-tab
// (#147, vedi proxy-tab.spec.mjs). Asserisce il COMPORTAMENTO:
//
//   - l'agente conversazionale ha accesso alle stesse primitive della UI:
//     APRI_DA_PAESE instrada la tab web attiva, RIMUOVI_PROXY (tutte) la/le
//     riporta in Italia — verifichiamo eseguendo davvero le azioni dispatch;
//   - "questo sito sempre dagli USA" (REGOLA_PROXY_DOMINIO) salva una regola
//     persistente: finisce nelle impostazioni (storage.json) → sopravvive al
//     riavvio dell'app, ed è rimovibile;
//   - con una regola attiva, una tab che NASCE su quel dominio parte già
//     proxata sulla location indicata (non serve azione manuale).
//
// Usa un SOCKS5 locale come provider di test (come proxy-tab.spec.mjs).

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

// Mini server SOCKS5 (no-auth): registra le CONNECT e instrada verso
// 127.0.0.1 (così un dominio qualsiasi risolto lato proxy arriva al testServer).
async function startSocks5({ mapHostTo = null } = {}) {
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
        let host = null;
        let port = null;
        if (atyp === 0x01) {
          host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
          port = req.readUInt16BE(8);
        } else if (atyp === 0x03) {
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
      for (const s of live) { try { s.destroy(); } catch (_) {} }
      await new Promise((r) => server.close(r));
    },
  };
}

// Stato proxy della prima tab web nel main process.
async function webTabProxy(app) {
  return app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        if (!/^https?:/.test(t.url || '')) continue;
        return {
          id: t.id,
          partition: t.partition || null,
          proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null,
        };
      }
    }
    return null;
  });
}

// Configura l'endpoint del provider di test nelle impostazioni.
async function configureProvider(app, port) {
  await app.evaluate(async (_e, cfg) => {
    await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
  }, { endpoint: `socks5://127.0.0.1:${port}` });
}

test('regola persistente per dominio: salvata nelle impostazioni, la tab nasce già proxata', async ({ app, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5({ mapHostTo: '127.0.0.1' });
  try {
    await configureProvider(app, socks.port);
    const host = new URL(testServer.origin).hostname; // 127.0.0.1

    // L'utente in chat: "questo sito sempre dagli USA". La chat instrada la
    // richiesta verso la primitiva persistente via REGOLA_PROXY_DOMINIO (qui
    // il dominio è esplicito, come quando l'utente nomina il sito).
    const ruleRes = await app.evaluate((_e, h) =>
      globalThis.SN_EXECUTE_FILO_ACTION({ type: 'REGOLA_PROXY_DOMINIO', dominio: h, paese: 'us' }), host);
    expect(ruleRes.executed).toBe(true);

    // PERSISTENZA: la regola vive nelle impostazioni → in storage.json, lo
    // stesso store letto al boot. Sopravvive al riavvio dell'app per costruzione.
    const rules = await app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      return (s.proxy && s.proxy.domainRules) || {};
    });
    expect(rules[host]).toEqual({ country: 'us', tier: 'datacenter' });

    // NASCITA PROXATA: apri una NUOVA tab su quel dominio. Deve partire già
    // instradata da un altro paese, senza alcuna azione manuale.
    const url = testServer.html('<title>RULE</title><h1 id="ok">contenuto</h1>');
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w._filoTabs.openTab(u, { activate: true });
    }, url);

    // La view viene ricreata nella partition proxata e ricaricata via SOCKS.
    await expect.poll(() => socks.connections.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(async () => {
      const info = await webTabProxy(app);
      return info && info.proxy ? info.proxy.country : null;
    }, { timeout: 30_000 }).toBe('us');
    const info = await webTabProxy(app);
    expect(info.partition).toBe(`proxy:${info.id}`); // partition dedicata

    // RIMOZIONE: "togli la regola per questo sito" → la regola sparisce davvero
    // dalle impostazioni (domainRules è REPLACE_KEY, non si rifonde).
    const rmRes = await app.evaluate((_e, h) =>
      globalThis.SN_EXECUTE_FILO_ACTION({ type: 'REGOLA_PROXY_DOMINIO', dominio: h, rimuovi: true }), host);
    expect(rmRes.executed).toBe(true);
    const after = await app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      return (s.proxy && s.proxy.domainRules) || {};
    });
    expect(after[host]).toBeUndefined();
  } finally {
    await socks.close();
  }
});

test('primitive via azione: APRI_DA_PAESE instrada la tab attiva, RIMUOVI_PROXY tutte le riporta in Italia', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5({ mapHostTo: '127.0.0.1' });
  try {
    const url = testServer.html('<title>NL</title><h1 id="ok">contenuto</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProvider(app, socks.port);

    const before = await webTabProxy(app);
    expect(before.proxy).toBeNull(); // pre-condizione: diretta

    // "Apri questa scheda dalla Francia" → APRI_DA_PAESE instrada la tab ATTIVA
    // (quella appena aperta) via fr. Stessa primitiva del menu tasto destro.
    const r = await app.evaluate(() =>
      globalThis.SN_EXECUTE_FILO_ACTION({ type: 'APRI_DA_PAESE', paese: 'fr' }));
    expect(r.executed).toBe(true);
    await expect.poll(async () => {
      const i = await webTabProxy(app);
      return i && i.proxy ? i.proxy.country : null;
    }, { timeout: 30_000 }).toBe('fr');
    await expect.poll(() => socks.connections.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // "Chiudi tutte le schede aperte da un altro paese" → RIMUOVI_PROXY tutte:true
    // enumera e toglie il proxy da ognuna: la tab torna alla connessione diretta.
    const clr = await app.evaluate(() =>
      globalThis.SN_EXECUTE_FILO_ACTION({ type: 'RIMUOVI_PROXY', tutte: true }));
    expect(clr.executed).toBe(true);
    await expect.poll(async () => {
      const i = await webTabProxy(app);
      return i ? i.proxy : 'pending';
    }, { timeout: 30_000 }).toBeNull();
  } finally {
    await socks.close();
  }
});
