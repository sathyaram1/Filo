// Verifica #589 — giro 5, porta del giro 3 ri-provata (nessun rilievo): una
// pagina di un sito che si porta su un indirizzo che non comincia per http
// (blob:) resta un sito per le impostazioni, sia chiedendole sia ricevendole.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const CHIAVE = 'sk-or-v1-G5-BLOB-589';
const PWD = 'PWD-G5-BLOB-589';

const nelContentScript = (app, scegli, codice) => app.evaluate(async ({ webContents }, { scegli, codice, mondo }) => {
  const trova = new Function('u', `return (${scegli})(u);`); // eslint-disable-line no-new-func
  const wc = webContents.getAllWebContents().find((w) => trova(String(w.getURL())));
  if (!wc) throw new Error('pagina non trovata');
  return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
}, { scegli, codice, mondo: MONDO_CONTENT_SCRIPT });

test('una pagina blob: fabbricata dal sito non riceve né ottiene chiavi e proxy', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(({ k, p }) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: k }, proxy: { datacenter: `socks5://u:${p}@gate.example.com:7000` } },
  }), { k: CHIAVE, p: PWD });

  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  await web.evaluate(() => {
    const html = '<!doctype html><meta charset="utf-8"><h1>pagina del sito</h1><p>testo</p>';
    location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  });
  const suBlob = `(u) => u.startsWith('blob:')`;
  await expect.poll(async () => {
    try { return await nelContentScript(app, suBlob, 'typeof chrome !== "undefined" && !!chrome.runtime'); } catch (_) { return false; }
  }, { timeout: 15000 }).toBe(true);

  await nelContentScript(app, suBlob, `
    globalThis.__g5b = [];
    chrome.runtime.onMessage.addListener((m) => { try { globalThis.__g5b.push(JSON.stringify(m)); } catch (_) {} });
    true;
  `);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => nelContentScript(app, suBlob, 'globalThis.__g5b.filter((m) => m.includes("settings_updated")).length'), { timeout: 8000 })
    .toBeGreaterThan(0);

  const spinte = await nelContentScript(app, suBlob, 'globalThis.__g5b.join("\\n")');
  expect(spinte).not.toContain(CHIAVE);
  expect(spinte).not.toContain(PWD);

  const lette = await nelContentScript(app, suBlob, `
    (async () => JSON.stringify({
      get: await chrome.runtime.sendMessage({ type: 'get_settings' }),
      st: await chrome.storage.local.get(null).then((v) => v.settings),
    }))()
  `);
  expect(lette).not.toContain(CHIAVE);
  expect(lette).not.toContain(PWD);
  expect(JSON.parse(lette).get.settings.theme).toBe('dark');
});
