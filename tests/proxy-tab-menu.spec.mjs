// Menu tasto destro su tab — voce "Apri da un altro paese" + indicatore (#148,
// spec in proxy-per-tab-spec.md §3). I test esercitano il flusso UI reale:
//
//   - con un endpoint configurato, il right-click sulla tab mostra la voce
//     "Apri da un altro paese" (mai le parole VPN/proxy); il click diretto
//     proxa la tab col default (USA) e sulla tab compare l'indicatore col
//     codice paese;
//   - su tab proxata la voce diventa "Torna in Italia"; cliccarla de-proxa la
//     tab e l'indicatore scompare;
//   - la freccia della voce apre la lista delle location curate; scegliendo
//     "Francia" la tab viene proxata da fr (l'ultima location usata diventa
//     il default del prossimo click diretto);
//   - senza endpoint configurato la voce NON compare (una voce che non può
//     funzionare non deve esistere).
//
// Il proxy vero è un SOCKS5 locale (vedi proxy-tab.spec.mjs per i test di
// instradamento/anti-leak: qui il focus è la UI, ma le tab vengono proxate
// DAVVERO attraverso il server di test).

import { test, expect } from './fixtures/electron.mjs';
import { createServer as createNetServer, connect as netConnect } from 'node:net';

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
        let host = null;
        let port = null;
        if (atyp === 0x01) { host = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`; port = req.readUInt16BE(8); }
        else if (atyp === 0x03) { const len = req[4]; host = req.subarray(5, 5 + len).toString('utf8'); port = req.readUInt16BE(5 + len); }
        else { socket.end(); return; }
        connections.push({ host, port });
        const upstream = netConnect(port, atyp === 0x03 ? '127.0.0.1' : host, () => {
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

// Right-click reale sulla tab della shell → handler contextmenu → popup-menu.
async function rightClickTab(shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active') || document.querySelector('.tab');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
    }));
  });
}

// ── Interazione robusta col popup-menu ─────────────────────────────────────
// Il popup del menu è una BrowserWindow frameless che si chiude DA SOLA in due
// casi: (1) sul blur (cliccare altrove chiude il menu — voluto); (2) come effetto
// del click su una voce (la voce seleziona e il menu si chiude). Su headless,
// senza window manager, il focus è ballerino e questi eventi possono cadere in
// mezzo alle interazioni del test: un handle catturato prima diventa stale e,
// soprattutto, l'evaluate che ESEGUE il click può morire ("Target page closed")
// pur avendo GIÀ cliccato — quindi il valore di ritorno del click è inaffidabile.
// Regola d'oro (come da convenzioni: asserire il successo, non l'assenza di
// errore): non ci si fida del ritorno del click ma dell'ESITO osservabile, e si
// ripete (ri)aprendo il menu finché l'esito non si verifica.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lettura non bloccante: testo del popup che contiene `needle`, o null se assente.
async function readMenuOnce(app, needle) {
  for (const w of app.windows()) {
    try {
      const t = await w.evaluate((n) =>
        (document.body && document.body.innerText.includes(n)) ? document.body.innerText : null, needle);
      if (t != null) return t;
    } catch (_) {}
  }
  return null;
}

// (Ri)apre il menu con `doOpen()` finché compare il popup che contiene `needle`,
// poi ne ritorna il testo. Robusto anche se il primo tentativo di apertura si
// chiude prima di poter leggere.
async function openAndRead(app, doOpen, needle, timeout = 15_000) {
  let text = null;
  await expect.poll(async () => {
    text = await readMenuOnce(app, needle);
    if (text != null) return true;
    await doOpen();
    await sleep(120);
    text = await readMenuOnce(app, needle);
    return text != null;
  }, { timeout, intervals: [120, 200, 300, 400, 600, 800, 1000, 1200] }).toBe(true);
  return text;
}

// Best-effort: clicca `sel` (opzionalmente con testo che matcha `labelRe`) nel
// popup che contiene `needle`, se presente ORA. Ritorna true se ha cliccato o se
// una finestra candidata si è chiusa durante il click (il click potrebbe essere
// andato a segno). L'esito reale lo verifica il chiamante.
async function tryClick(app, needle, sel, labelRe) {
  for (const w of app.windows()) {
    try {
      const r = await w.evaluate(({ n, s, l }) => {
        if (!document.body || !document.body.innerText.includes(n)) return 'no';
        const nodes = [...document.querySelectorAll(s)];
        const btn = l ? nodes.find((b) => new RegExp(l).test(b.textContent)) : nodes[0];
        if (!btn) return 'no';
        btn.click();
        return 'yes';
      }, { n: needle, s: sel, l: labelRe || null });
      if (r === 'yes') return true;
    } catch (_) { return true; } // popup chiuso durante il click: forse è andato a segno
  }
  return false;
}

// Ripete `open()` (che porta il menu giusto in vista) e il click su
// needle/sel/labelRe finché `until()` (l'esito osservabile) non è vero.
async function clickUntil(app, { open, needle, sel = 'button.item', labelRe, until, timeout = 25_000 }) {
  await expect.poll(async () => {
    if (await until()) return true;
    await open();
    for (let i = 0; i < 15; i++) { if (await tryClick(app, needle, sel, labelRe)) break; await sleep(40); }
    await sleep(150);
    return await until();
  }, { timeout, intervals: [150, 200, 250, 350, 450, 600, 800, 1000, 1200] }).toBe(true);
}

async function configureProvider(app, port) {
  await app.evaluate(async (_e, cfg) => {
    await globalThis.SN_STORAGE.updateSettings({
      proxy: { datacenter: cfg.endpoint, bypass: '<-loopback>' },
    });
  }, { endpoint: `socks5://127.0.0.1:${port}` });
}

test('dal menu si proxa col default, l\'indicatore appare, "Torna in Italia" lo toglie', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>MENU_PROXY</title><h1 id="ok">pagina</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProvider(app, socks.port);

    const cc = () => shell.evaluate(() => {
      const e = document.querySelector('.tab .proxy-ind .cc'); return e ? e.textContent : null;
    });

    // ── Menu: la voce c'è, col wording giusto (mai VPN/proxy) ──
    const text = await openAndRead(app, () => rightClickTab(shell), 'Apri da un altro paese');
    expect(text).toMatch(/Apri da un altro paese/);
    expect(text).not.toMatch(/vpn|proxy/i); // mai gergo da security tool

    // ── Click diretto → proxa col default (USA) ──
    await clickUntil(app, {
      open: () => rightClickTab(shell),
      needle: 'Apri da un altro paese', labelRe: 'Apri da un altro paese',
      until: async () => (await cc()) === 'US',
    });
    // La tab è DAVVERO proxata: il SOCKS vede il traffico…
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // …e l'indicatore col codice paese compare sulla tab.
    await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('US', { timeout: 10_000 });

    // ── Su tab proxata la voce diventa "Torna in Italia" ──
    const text2 = await openAndRead(app, () => rightClickTab(shell), 'Torna in Italia');
    expect(text2).not.toMatch(/Apri da un altro paese/);
    await clickUntil(app, {
      open: () => rightClickTab(shell),
      needle: 'Torna in Italia', labelRe: 'Torna in Italia',
      until: () => shell.evaluate(() => !document.querySelector('.tab .proxy-ind')),
    });
    // L'indicatore scompare e la tab torna diretta.
    await expect(shell.locator('.tab .proxy-ind')).toHaveCount(0, { timeout: 10_000 });
    const info = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
      return { proxy: t.proxy, partition: t.partition || null };
    });
    expect(info.proxy).toBeNull();
    expect(info.partition).toBeNull();
  } finally {
    await socks.close();
  }
});

test('la freccia apre la lista paesi e "Francia" proxa da fr', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>MENU_PICK</title><h1 id="ok">pagina</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProvider(app, socks.port);

    await rightClickTab(shell);
    // La freccia del submenu è presente sulla voce → apre il secondo livello.
    await clickMenuArrow(app, 'Apri da un altro paese');

    // Secondo livello: la lista curata delle location.
    const text = await readMenuText(app, 'Francia');
    expect(text).toMatch(/Stati Uniti/);
    expect(text).toMatch(/Francia/);
    expect(text).not.toMatch(/vpn|proxy/i);
    await clickMenuItem(app, 'Francia', 'Francia');

    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('FR', { timeout: 10_000 });
    // L'ultima location usata diventa il default del prossimo click diretto.
    const status = await app.evaluate(async () => {
      const s = await globalThis.SN_STORAGE.getSettings();
      return s.proxy.lastCountry;
    });
    expect(status).toBe('fr');
  } finally {
    await socks.close();
  }
});

test('su tab già instradata "Cambia paese" apre la lista e cambia paese senza tornare in Italia', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const socks = await startSocks5();
  try {
    const url = testServer.html('<title>MENU_CHANGE</title><h1 id="ok">pagina</h1>');
    const page = await openTab(url);
    await page.waitForSelector('#ok');
    await configureProvider(app, socks.port);

    // Proxa col default (USA).
    await rightClickTab(shell);
    await clickMenuItem(app, 'Apri da un altro paese', 'Apri da un altro paese');
    await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('US', { timeout: 10_000 });

    // Su tab proxata il menu offre "Cambia paese" (oltre a "Torna in Italia"),
    // senza obbligare a tornare diretti prima di re-instradare.
    await rightClickTab(shell);
    const text2 = await readMenuText(app, 'Cambia paese');
    expect(text2).toMatch(/Cambia paese/);
    expect(text2).toMatch(/Torna in Italia/);
    expect(text2).not.toMatch(/vpn|proxy/i);

    // "Cambia paese" apre la lista delle location.
    await clickMenuItem(app, 'Cambia paese', 'Cambia paese');
    await clickMenuItem(app, 'Francia', 'Francia');

    // La tab è re-instradata da fr (mai passata per l'Italia: resta proxata).
    await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('FR', { timeout: 10_000 });
    const proxy = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => /^https?:/.test(x.url || ''));
      return t.proxy && t.proxy.country;
    });
    expect(proxy).toBe('fr');
  } finally {
    await socks.close();
  }
});

test('senza endpoint configurato la voce non compare', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>MENU_NOCFG</title><p id="p">ok</p>');
  const page = await openTab(url);
  await page.waitForSelector('#p');
  await rightClickTab(shell);
  // Il menu standard si apre (Duplica c'è) ma la voce paese no.
  const text = await readMenuText(app, 'Duplica');
  expect(text).not.toMatch(/Apri da un altro paese/);
  expect(text).toMatch(/Chiudi/);
});
