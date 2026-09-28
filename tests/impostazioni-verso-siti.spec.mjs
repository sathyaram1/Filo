// #589 — quando un'impostazione cambia, il content script di un sito riceve il
// cambio (il tema si applica) ma non le chiavi dei servizi né le credenziali del
// proxy; la pagina filo:// accanto riceve l'oggetto intero. Si legge il messaggio
// DENTRO il mondo isolato dei content script, dove arriva davvero.

import { test, expect } from './fixtures/electron.mjs';

const CHIAVE = 'sk-or-v1-SPINTA-589-' + Date.now();
const PROXY = 'socks5://utente-{country}:parolasegreta589@gate.provider.example:7000';
// Il mondo isolato del preload (contextIsolation) è il 999 in Electron.
const MONDO_CONTENT_SCRIPT = 999;

async function nelContentScript(app, origine, codice) {
  return app.evaluate(async ({ webContents }, { origine, codice, mondo }) => {
    const wc = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith(origine));
    if (!wc) throw new Error('scheda del mini server non trovata');
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
  }, { origine, codice, mondo: MONDO_CONTENT_SCRIPT });
}

test('un cambio di impostazioni arriva al sito senza chiavi né proxy, e intero alla pagina filo://', async ({ app, shell, openTab, testServer }) => {
  void shell; // boot finito: la semina qui sotto non corre col read-modify-write iniziale
  await app.evaluate(async (_e, { chiave, proxy }) => {
    const S = globalThis.__filoStorage;
    const cur = (await S.get('settings')).settings || {};
    await S.set({ settings: {
      ...cur,
      theme: 'light',
      apiKeys: { ...(cur.apiKeys || {}), openrouter: chiave },
      proxy: { ...(cur.proxy || {}), datacenter: proxy, residential: proxy },
    } });
  }, { chiave: CHIAVE, proxy: PROXY });

  const sito = await testServer.openReady(openTab, '<!doctype html><html><body><p>Una pagina qualunque.</p></body></html>');
  await sito.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  await expect.poll(() => sito.evaluate(() => document.documentElement.dataset.snTheme)).toBe('light');

  await nelContentScript(app, testServer.origin, `
    globalThis.__spia589 = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === SN_MSG.MSG.SETTINGS_UPDATED) globalThis.__spia589.push(JSON.stringify(m));
    });
    true;
  `);

  const interna = await openTab('filo://history/history.html');
  await interna.waitForFunction(() => !!(window.filo && window.filo.onBroadcast), null, { timeout: 8000 });
  await interna.evaluate(() => {
    window.__spia589 = [];
    window.filo.onBroadcast((m) => { if (m && m.type === 'settings_updated') window.__spia589.push(JSON.stringify(m)); });
  });

  // Il cambio passa dall'handler vero, come dalle Preferenze.
  await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE({ type: MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { url: 'filo://preferences/preferences.html' });
  });

  // Il sito: il cambio arriva e si applica…
  await expect.poll(() => sito.evaluate(() => document.documentElement.dataset.snTheme), { timeout: 8000 }).toBe('dark');
  const ricevuti = await nelContentScript(app, testServer.origin, 'globalThis.__spia589');
  expect(ricevuti.length, 'il content script del sito deve ricevere il cambio').toBeGreaterThan(0);
  const ultimo = JSON.parse(ricevuti[ricevuti.length - 1]);
  expect(ultimo.settings.theme).toBe('dark');
  // …ma senza segreti.
  for (const m of ricevuti) {
    expect(m).not.toContain(CHIAVE);
    expect(m).not.toContain('parolasegreta589');
  }
  expect(ultimo.settings.apiKeys).toBeUndefined();
  expect(ultimo.settings.proxy).toBeUndefined();

  // Le letture dal content script seguono la stessa regola della spinta.
  const letture = await nelContentScript(app, testServer.origin, `
    (async () => {
      const get = await chrome.runtime.sendMessage({ type: SN_MSG.MSG.GET_SETTINGS });
      const st = await chrome.storage.local.get(null);
      return JSON.stringify({ get: get.settings, storage: st.settings });
    })()
  `);
  expect(letture).not.toContain(CHIAVE);
  expect(letture).not.toContain('parolasegreta589');
  expect(JSON.parse(letture).get.theme).toBe('dark');

  // La pagina filo:// riceve l'oggetto intero: le Opzioni ci leggono le chiavi.
  await expect.poll(() => interna.evaluate(() => window.__spia589.length), { timeout: 8000 }).toBeGreaterThan(0);
  const interno = JSON.parse(await interna.evaluate(() => window.__spia589[window.__spia589.length - 1]));
  expect(interno.settings.theme).toBe('dark');
  expect(interno.settings.apiKeys.openrouter).toBe(CHIAVE);
  expect(interno.settings.proxy.datacenter).toBe(PROXY);
});
