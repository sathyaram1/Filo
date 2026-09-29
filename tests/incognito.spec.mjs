import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

// FB1 — Modalità incognito.
//
// Due garanzie da verificare, entrambe asseriscono SUCCESSO (fallirebbero senza
// il fix):
//
//  1) Privacy dello storage filo://: dentro un contesto incognito le chiavi di
//     "memoria" (cronologia, salvati, costi, …) NON toccano il disco e NON sono
//     leggibili da disco; le chiavi di "config" (settings, …) restano leggibili
//     (passthrough). Ciò che l'incognito scrive vive solo in RAM e sparisce al
//     reset. Pilotiamo direttamente lo shim di storage nel main process.
//
//  2) UI/finestra: l'ingresso `openIncognito` apre una SECONDA finestra con un
//     TabManager incognito (partizione effimera) e la shell mostra il badge
//     "Incognito" con il tema dedicato.

test('incognito storage: memoria in RAM, config passthrough, disco intatto', async ({ app }) => {
  const out = await app.evaluate(async () => {
    // app.evaluate gira nel main process ma senza `require` in scope: lo shim
    // si auto-espone su globalThis quando NODE_ENV=test (vedi storage.js).
    const DiskStorage = globalThis.__filoStorage;

    // Seed su DISCO (contesto normale): una chiave config + una chiave memoria.
    await DiskStorage.set({ settings: { theme: 'dark', _probe: 'disk-settings' } });
    await DiskStorage.set({ aiHistory: ['real-entry'] });

    // Dentro incognito: leggi config (passthrough), leggi memoria (nascosta),
    // scrivi memoria (solo overlay) e rileggila (read-back dall'overlay).
    const incog = await DiskStorage.runIncognito(async () => {
      const s = await DiskStorage.get('settings');
      const h0 = await DiskStorage.get('aiHistory');
      await DiskStorage.set({ aiHistory: ['incognito-only'] });
      const h1 = await DiskStorage.get('aiHistory');
      // Anche una nuova chiave memoria scritta in incognito non deve persistere.
      await DiskStorage.set({ savedPages: [{ id: 'x', url: 'http://secret' }] });
      return {
        settingsProbe: s.settings?._probe,
        hiddenHistory: h0.aiHistory,
        overlayHistory: h1.aiHistory,
      };
    });

    // Fuori incognito: il disco (STATE in memoria, sorgente del file) è intatto.
    const afterHistory = (await DiskStorage.get('aiHistory')).aiHistory;
    const afterSaved = (await DiskStorage.get('savedPages')).savedPages;

    // Dopo il reset overlay, nessuna traccia dell'incognito.
    DiskStorage.resetIncognito();
    const resetHistory = await DiskStorage.runIncognito(async () => (await DiskStorage.get('aiHistory')).aiHistory);

    return { ...incog, afterHistory, afterSaved, resetHistory };
  });

  // Config ereditata dal disco anche in incognito.
  expect(out.settingsProbe).toBe('disk-settings');
  // Memoria su disco invisibile dall'incognito.
  expect(out.hiddenHistory).toBeUndefined();
  // Scrittura incognito visibile solo nell'overlay della stessa sessione.
  expect(out.overlayHistory).toEqual(['incognito-only']);
  // Il disco NON è stato toccato dalle scritture incognito.
  expect(out.afterHistory).toEqual(['real-entry']);
  expect(out.afterSaved).toBeUndefined();
  // Dopo il reset, una nuova sessione incognito non vede nulla della precedente
  // (e la memoria su disco resta comunque nascosta).
  expect(out.resetHistory).toBeUndefined();
});

test('incognito window: seconda finestra, TabManager effimero, badge visibile', async ({ app, shell }) => {
  // Ingresso reale: la voce "Nuova finestra incognito" del menu Impostazioni
  // chiama questa API del preload della shell.
  await shell.evaluate(() => window.filoShell.openIncognito());

  // Attendi che il main abbia creato la finestra incognito.
  const deadline = Date.now() + 15000;
  let info = null;
  while (Date.now() < deadline) {
    info = await app.evaluate(({ BrowserWindow }) => {
      const incog = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
      if (!incog) return null;
      const tabs = incog._filoTabs;
      return {
        count: BrowserWindow.getAllWindows().length,
        tabsIncognito: !!(tabs && tabs.incognito),
        partition: (tabs && tabs.partition) || null,
      };
    });
    if (info) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  expect(info, 'la finestra incognito deve aprirsi').toBeTruthy();
  expect(info.count).toBeGreaterThanOrEqual(2); // finestra normale + incognito
  expect(info.tabsIncognito).toBe(true);
  expect(info.partition).toMatch(/^filo-incognito-/);

  // La shell incognito (filo://shell/shell.html?incognito=1) applica il tema e
  // mostra il badge. Playwright registra la Page in modo asincrono: come fa il
  // fixture openTab, facciamo polling su app.windows() invece di uno snapshot.
  const pageDeadline = Date.now() + 10000;
  let incogShell = null;
  while (Date.now() < pageDeadline) {
    incogShell = app.windows().find((p) => {
      try { return p.url().includes('incognito=1'); } catch (_) { return false; }
    });
    if (incogShell) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const urls = app.windows().map((p) => { try { return p.url(); } catch (_) { return '?'; } });
  expect(incogShell, `la Page della shell incognito deve esistere (viste: ${urls.join(' | ')})`).toBeTruthy();
  await incogShell.waitForLoadState('domcontentloaded').catch(() => {});
  await incogShell.waitForFunction(
    () => document.documentElement.dataset.incognito === '1',
    null,
    { timeout: 8000 },
  );
  const badge = await incogShell.evaluate(() => {
    const el = document.getElementById('incognito-badge');
    if (!el) return { present: false };
    return {
      present: true,
      hidden: el.hidden,
      hasSvg: !!el.querySelector('svg'),
      text: (el.textContent || '').trim(),
    };
  });
  expect(badge.present).toBe(true);
  expect(badge.hidden).toBe(false);
  expect(badge.hasSvg).toBe(true);
  expect(badge.text).toContain('Incognito');
});

// #839 — le scorciatoie vanno alla finestra che l'utente ha davanti: con l'incognito davanti, Alt+S salva e chiude
// la pagina dell'incognito, non quella della finestra normale che sta dietro (prima andavano sempre alla principale).
test('Alt+S con la finestra in incognito davanti salva e chiude la pagina di quella finestra', async ({ app, shell, openTab, testServer }) => {
  const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body><h1>${t}</h1></body></html>`;
  await testServer.openReady(openTab, pagina('Finestra normale'));
  await app.evaluate(({ BrowserWindow }) => { globalThis.__finestraNormale = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito); });
  await shell.evaluate(() => window.filoShell.openIncognito());
  const incognito = () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.map((t) => t.title) : null;
  });
  // La nuova scheda dell'incognito nasce quando la sua barra ha finito di caricarsi: la pagina si apre dopo.
  await expect.poll(async () => ((await incognito()) || []).length, { timeout: 15000 }).toBe(1);
  const url = testServer.html(pagina('In incognito'));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    w._filoTabs.openTab(u);
    w.show(); w.focus();
  }, url);
  await expect.poll(async () => {
    const p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return p ? p.evaluate(() => document.documentElement.dataset.filoContentReady === '1').catch(() => false) : false;
  }, { timeout: 10000 }).toBe(true);

  // Il tasto registrato per tutto il sistema passa la finestra con cui è stato registrato: la normale.
  await app.evaluate(() => { globalThis.__filoShortcuts.dispatch('save-for-later', globalThis.__finestraNormale); });

  await expect.poll(async () => (await incognito()).includes('In incognito'), { timeout: 10000, message: 'la pagina in incognito davanti doveva chiudersi' }).toBe(false);
  const normale = await app.evaluate(() => globalThis.__finestraNormale._filoTabs.tabs.map((t) => t.title));
  expect(normale, 'la pagina della finestra normale, dietro, non va toccata').toContain('Finestra normale');
  // Salvata come fa l'incognito: nella memoria della sessione, non sul disco.
  const salvate = await app.evaluate(async () => ({
    disco: (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url),
    sessione: await globalThis.__filoStorage.runIncognito(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url)),
  }));
  expect(salvate).toEqual({ disco: [], sessione: [url] });
});

// #839 — quando la pagina non prende Alt+S (bloccata, ancora in caricamento) salva il main: in incognito anche lui
// scrive nella memoria della sessione, come la pagina. Prima finiva nella lista normale sul disco.
async function apriIncognitoCon(app, shell, url) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w ? w._filoTabs.tabs.length : 0;
  }), { timeout: 15000 }).toBe(1);
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    w._filoTabs.openTab(u); w.show(); w.focus();
  }, url);
}
const apertaInIncognito = (app, u) => app.evaluate(({ BrowserWindow }, x) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.tabs.some((t) => t.url === x), u);
async function altSInIncognitoSalvaNellaSessione(app, url, titolo) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('save-for-later', BrowserWindow.getAllWindows().find((x) => x._filoIncognito));
  });
  await expect.poll(() => apertaInIncognito(app, url), { timeout: 12000, message: 'la scheda salvata doveva chiudersi' }).toBe(false);
  await expect.poll(() => app.evaluate(async () => (await globalThis.__filoStorage.runIncognito(() => globalThis.SN_SAVED_PAGES.list())).length), { timeout: 8000 }).toBe(1);
  const salvate = await app.evaluate(async () => ({
    disco: (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url),
    sessione: await globalThis.__filoStorage.runIncognito(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url)),
  }));
  expect(salvate, 'la pagina vista in incognito non va nella lista normale sul disco').toEqual({ disco: [], sessione: [url] });
  // «Aperti per dopo» della finestra in incognito la mostra.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab('filo://home/home.html'));
  let lista = null;
  await expect.poll(() => { lista = app.windows().find((w) => { try { return w.url().startsWith('filo://home/home.html'); } catch (_) { return false; } }); return !!lista; }, { timeout: 8000 }).toBe(true);
  await expect(lista.locator('.sn-card', { hasText: titolo })).toHaveCount(1, { timeout: 8000 });
}

test('Alt+S in incognito su una pagina che non risponde la salva nella sessione, non sul disco', async ({ app, shell, openTab, testServer }) => {
  const pagina = (t) => `<!doctype html><html><head><meta charset="utf-8"><title>${t}</title></head><body><h1>${t}</h1></body></html>`;
  await testServer.openReady(openTab, pagina('Finestra normale'));
  const url = testServer.html(pagina('Segreta bloccata'));
  await apriIncognitoCon(app, shell, url);
  let p = null;
  await expect.poll(async () => {
    p = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return p ? p.evaluate(() => document.documentElement.dataset.filoContentReady === '1').catch(() => false) : false;
  }, { timeout: 10000 }).toBe(true);
  await p.evaluate(() => { setTimeout(() => { const t = Date.now(); while (Date.now() - t < 10000) { /* occupata */ } }, 50); });
  await p.waitForTimeout(200);
  await altSInIncognitoSalvaNellaSessione(app, url, 'Segreta bloccata');
});

test('Alt+S in incognito su una pagina ancora in caricamento la salva nella sessione, non sul disco', async ({ app, shell, openTab, testServer }) => {
  const attese = [];
  const server = createServer((req, res) => {
    if (req.url.startsWith('/lento.js')) { attese.push(res); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Segreta lenta</title></head><body><h1>Segreta lenta</h1><script src="/lento.js"></script></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${server.address().port}/p`;
  try {
    await testServer.openReady(openTab, '<!doctype html><title>Finestra normale</title><h1>Finestra normale</h1>');
    await apriIncognitoCon(app, shell, url);
    await expect.poll(() => apertaInIncognito(app, url), { timeout: 8000 }).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    await altSInIncognitoSalvaNellaSessione(app, url, 'Segreta lenta');
  } finally {
    for (const res of attese.splice(0)) { try { res.end(''); } catch (_) {} }
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
