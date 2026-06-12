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

// Trova la finestra-popup del menu che contiene `needle` nel testo.
async function findMenuPopup(app, needle, timeout = 8_000) {
  let popup = null;
  await expect.poll(async () => {
    for (const w of app.windows()) {
      try {
        const has = await w.evaluate(
          (n) => !!document.body && document.body.innerText.includes(n), needle);
        if (has) { popup = w; return true; }
      } catch (_) {}
    }
    return false;
  }, { timeout }).toBe(true);
  return popup;
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

    // ── Menu: la voce c'è, col wording giusto (mai VPN/proxy) ──
    await rightClickTab(shell);
    const menu = await findMenuPopup(app, 'Apri da un altro paese');
    const text = await menu.evaluate(() => document.body.innerText);
    expect(text).toMatch(/Apri da un altro paese/);
    expect(text).not.toMatch(/vpn|proxy/i); // mai gergo da security tool

    // ── Click diretto → proxa col default (USA) ──
    await menu.evaluate(() => {
      const btn = [...document.querySelectorAll('button.item')]
        .find((b) => /Apri da un altro paese/.test(b.textContent));
      btn.click();
    });
    // La tab è DAVVERO proxata: il SOCKS vede il traffico…
    await expect.poll(() => socks.connections.length, { timeout: 15_000 }).toBeGreaterThan(0);
    // …e l'indicatore col codice paese compare sulla tab.
    await expect(shell.locator('.tab .proxy-ind .cc')).toHaveText('US', { timeout: 10_000 });

    // ── Su tab proxata la voce diventa "Torna in Italia" ──
    await rightClickTab(shell);
    const menu2 = await findMenuPopup(app, 'Torna in Italia');
    const text2 = await menu2.evaluate(() => document.body.innerText);
    expect(text2).not.toMatch(/Apri da un altro paese/);
    await menu2.evaluate(() => {
      const btn = [...document.querySelectorAll('button.item')]
        .find((b) => /Torna in Italia/.test(b.textContent));
      btn.click();
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
    const menu = await findMenuPopup(app, 'Apri da un altro paese');
    // La freccia del submenu è presente sulla voce.
    await menu.evaluate(() => {
      const arrow = document.querySelector('button.subarrow');
      if (!arrow) throw new Error('freccia submenu assente');
      arrow.click();
    });

    // Secondo livello: la lista curata delle location.
    const picker = await findMenuPopup(app, 'Francia');
    const text = await picker.evaluate(() => document.body.innerText);
    expect(text).toMatch(/Stati Uniti/);
    expect(text).toMatch(/Francia/);
    expect(text).not.toMatch(/vpn|proxy/i);
    await picker.evaluate(() => {
      const btn = [...document.querySelectorAll('button.item')]
        .find((b) => /Francia/.test(b.textContent));
      btn.click();
    });

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

test('senza endpoint configurato la voce non compare', async ({ app, shell, openTab, testServer }) => {
  const url = testServer.html('<title>MENU_NOCFG</title><p id="p">ok</p>');
  const page = await openTab(url);
  await page.waitForSelector('#p');
  await rightClickTab(shell);
  // Il menu standard si apre (Duplica c'è) ma la voce paese no.
  const menu = await findMenuPopup(app, 'Duplica');
  const text = await menu.evaluate(() => document.body.innerText);
  expect(text).not.toMatch(/Apri da un altro paese/);
  expect(text).toMatch(/Chiudi/);
});
