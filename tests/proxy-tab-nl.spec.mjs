// Proxy per-tab via LINGUAGGIO NATURALE + regole persistenti per dominio (#152).
//
// L'agente conversazionale di Filo ha accesso alle stesse primitive della UI:
//   - PROXY_TAB {country}        → setTabProxy sulla scheda web attiva
//   - RIMUOVI_PROXY              → clearTabProxy ("torna in Italia")
//   - RIMUOVI_PROXY_TUTTE        → enumerazione + clearTabProxy su tutte
//   - REGOLA_PROXY_DOMINIO       → regola persistente "questo sito sempre da X"
//   - RIMUOVI_REGOLA_PROXY       → toglie la regola
//
// Questi test ASSERISCONO IL SUCCESSO (non l'assenza di errore): l'azione
// instrada davvero la scheda attraverso il proxy, la regola viene salvata, e
// alla riapertura del dominio la scheda NASCE già proxata — anche dopo un
// riavvio dell'app (la regola vive nello storage, come profilo/preferenze).
//
// Un SOCKS5 locale fa da provider di test (rimappa ogni hostname su 127.0.0.1,
// così un host inesistente .invalid si carica SOLO se instradato dal proxy).

import { test, expect } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');

// ── mini SOCKS5 (no-auth) che rimappa ogni dominio su 127.0.0.1 ──────────────
async function startSocks5({ mapHostTo = '127.0.0.1' } = {}) {
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

// ── helper main-process: stato/azioni via app.evaluate ───────────────────────

// Esegue un'azione dell'agente nel main, costruendo un sender con la finestra
// reale (così "questa tab" risolve la scheda web attiva). È il vero percorso
// di routing comando→primitiva, lo stesso di handleFiloChat.
function runAction(app, action) {
  return app.evaluate(async ({ BrowserWindow }, act) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(act, { sender: { win } });
  }, action);
}

// Regole proxy persistenti correnti (da SN_FILO_MEMORY → storage).
function proxyRules(app) {
  return app.evaluate(() => globalThis.SN_FILO_MEMORY.listProxyRules());
}

// Stato proxy di un tab dato un frammento del suo URL.
function tabByUrl(app, urlSubstr) {
  return app.evaluate(({ BrowserWindow }, sub) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w._filoTabs) continue;
      for (const t of w._filoTabs.tabs) {
        if ((t.url || '').includes(sub)) {
          return {
            id: t.id,
            url: t.url,
            partition: t.partition || null,
            proxy: t.proxy ? { country: t.proxy.country, tier: t.proxy.tier } : null,
          };
        }
      }
    }
    return null;
  }, urlSubstr);
}

// Ritrova la Page Playwright viva con il selettore (la view ricreata da
// setTabProxy è la più recente; gli handle morti vanno scartati).
async function waitPageWith(app, predicate, selector, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastErr = null;
  while (Date.now() < deadline) {
    const candidates = app.windows().filter((w) => {
      try { return !w.isClosed() && predicate(w.url()); } catch (_) { return false; }
    });
    for (const p of candidates.reverse()) {
      try { await p.waitForSelector(selector, { timeout: 2_000 }); return p; }
      catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`waitPageWith: nessuna window viva con ${selector} — ${lastErr?.message || 'nessun candidato'}`);
}

// Apre un URL come tab dalla shell e ritorna l'id main-process della scheda
// (più affidabile della Page quando la view viene subito ricreata proxata).
async function openTabId(app, shell, url, urlSubstr) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const t = await tabByUrl(app, urlSubstr);
    if (t) return t.id;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`openTabId: nessuna scheda per ${url}`);
}

test('linguaggio naturale: PROXY_TAB instrada la scheda attiva, RIMUOVI_PROXY(_TUTTE) la riporta diretta', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    await app.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
    }, { endpoint: `socks5://127.0.0.1:${socks.port}` });

    const url = testServer.html('<title>NL_PROXY</title><h1 id="ok">ciao</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    const before = await tabByUrl(app, '127.0.0.1');
    expect(before.proxy).toBeNull();

    // "apri questa tab dalla Francia" → PROXY_TAB {country:'fr'}.
    const r = await runAction(app, { type: 'PROXY_TAB', country: 'fr' });
    expect(r.executed).toBe(true);
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await waitPageWith(app, (u) => u === url, '#ok'); // ricaricata ATTRAVERSO il proxy
    const proxied = await tabByUrl(app, '127.0.0.1');
    expect(proxied.proxy).toEqual({ country: 'fr', tier: 'datacenter' });
    expect(proxied.partition).toBe(`proxy:${before.id}`);

    // "torna in Italia" → RIMUOVI_PROXY.
    const back = await runAction(app, { type: 'RIMUOVI_PROXY' });
    expect(back.executed).toBe(true);
    await expect.poll(async () => (await tabByUrl(app, '127.0.0.1')).proxy).toBeNull();

    // Re-instrada, poi "togli il proxy da tutte le schede" → RIMUOVI_PROXY_TUTTE.
    await runAction(app, { type: 'PROXY_TAB', country: 'us' });
    await expect.poll(async () => (await tabByUrl(app, '127.0.0.1'))?.proxy?.country).toBe('us');
    const all = await runAction(app, { type: 'RIMUOVI_PROXY_TUTTE' });
    expect(all.executed).toBe(true);
    expect(all.output.count).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await tabByUrl(app, '127.0.0.1')).proxy).toBeNull();
  } finally {
    await socks.close();
  }
});

test('regola persistente per dominio: REGOLA_PROXY_DOMINIO salva, la riapertura nasce proxata, RIMUOVI_REGOLA_PROXY toglie', async ({ app, shell, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5(); // rimappa ogni dominio → 127.0.0.1
  try {
    await app.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
    }, { endpoint: `socks5://127.0.0.1:${socks.port}` });

    // Host INESISTENTE in locale (.invalid): si carica SOLO se instradato dal
    // proxy, che ne risolve il DNS lato suo (semantica socks5h).
    const url = testServer.html('<title>NL_RULE</title><h1 id="ok">contenuto</h1>');
    const fakeHostUrl = url.replace('127.0.0.1', 'geo-rule-test.filo.invalid');

    // "questo sito sempre dagli USA" → REGOLA_PROXY_DOMINIO {country, dominio}.
    const set = await runAction(app, { type: 'REGOLA_PROXY_DOMINIO', country: 'us', dominio: fakeHostUrl });
    expect(set.executed).toBe(true);
    // Regola DAVVERO salvata (asserisce successo, non assenza d'errore).
    const rules = await proxyRules(app);
    const keys = Object.keys(rules);
    expect(keys.length).toBe(1);
    expect(rules[keys[0]].country).toBe('us');

    // Riapertura del dominio → la scheda NASCE già proxata e si carica via proxy.
    const id = await openTabId(app, shell, fakeHostUrl, 'filo.invalid');
    await expect.poll(async () => (await tabByUrl(app, 'filo.invalid'))?.proxy?.country, { timeout: 20_000 }).toBe('us');
    await waitPageWith(app, (u) => u.includes('filo.invalid'), '#ok'); // caricata = instradata dal proxy
    const born = await tabByUrl(app, 'filo.invalid');
    expect(born.partition).toBe(`proxy:${id}`);
    // Il proxy ha ricevuto il NOME di dominio (DNS lato proxy, niente leak).
    expect(socks.connections.some((c) => c.host === 'geo-rule-test.filo.invalid' && c.atyp === 'domain')).toBe(true);

    // "togli la regola sugli USA per questo sito" → RIMUOVI_REGOLA_PROXY.
    const rm = await runAction(app, { type: 'RIMUOVI_REGOLA_PROXY', dominio: fakeHostUrl });
    expect(rm.executed).toBe(true);
    expect(await proxyRules(app)).toEqual({});
  } finally {
    await socks.close();
  }
});

test('la regola persistente sopravvive al RIAVVIO: riaprendo il dominio la scheda nasce proxata', async ({ testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  const userData = mkdtempSync(join(tmpdir(), 'filo-test-proxynl-'));
  const launchOpts = {
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  };

  const url = testServer.html('<title>NL_RESTART</title><h1 id="ok">contenuto</h1>');
  const fakeHostUrl = url.replace('127.0.0.1', 'geo-restart-test.filo.invalid');

  // ── Avvio 1: configura il provider e salva la regola via l'AZIONE reale
  //    (stesso routing dell'agente), poi forza il flush su disco e chiudi. ──
  let app1 = await electron.launch(launchOpts);
  try {
    await app1.firstWindow();
    await app1.evaluate(async (_e, cfg) => {
      await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' } });
    }, { endpoint: `socks5://127.0.0.1:${socks.port}` });
    const set = await runAction(app1, { type: 'REGOLA_PROXY_DOMINIO', country: 'us', dominio: fakeHostUrl });
    expect(set.executed).toBe(true);
    // Garantisce che la regola sia su disco PRIMA della chiusura (le scritture
    // dello storage sono debounced a 100ms). __filoStorage è lo shim esposto
    // sotto NODE_ENV=test; flushSync scrive subito storage.json.
    await app1.evaluate(() => globalThis.__filoStorage.flushSync());
  } finally {
    await app1.close();
  }

  // ── Avvio 2: stesso userData. La regola DEVE essere ancora lì e la
  //    riapertura del dominio nasce proxata (born proxied dopo riavvio). ──
  let app2 = await electron.launch(launchOpts);
  try {
    const shell2 = await app2.firstWindow();
    await shell2.waitForLoadState('domcontentloaded');
    // Sopravvissuta al riavvio.
    const rules = await proxyRules(app2);
    expect(Object.keys(rules).length).toBe(1);
    expect(Object.values(rules)[0].country).toBe('us');

    const id = await openTabId(app2, shell2, fakeHostUrl, 'filo.invalid');
    await expect.poll(async () => (await tabByUrl(app2, 'filo.invalid'))?.proxy?.country, { timeout: 20_000 }).toBe('us');
    await waitPageWith(app2, (u) => u.includes('filo.invalid'), '#ok');
    const born = await tabByUrl(app2, 'filo.invalid');
    expect(born.partition).toBe(`proxy:${id}`);
  } finally {
    await app2.close();
    await socks.close();
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
