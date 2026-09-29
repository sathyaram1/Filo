// Verifica #589 — giro 8: il ripristino delle impostazioni e un cambio di tema
// arrivano al codice di Filo dentro un sito ritagliati, senza chiave né proxy.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO = 999;
const CHIAVE = 'sk-or-v1-GIRO8-CHIAVE';
const PWD = 'GIRO8-PWD-PROXY';

function nelSito(app, host) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { h, codice, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
  }, { h: host, codice, mondo: MONDO });
}

const ascolta = (esegui) => esegui(`(() => {
  if (!globalThis.__g8) {
    globalThis.__g8 = [];
    chrome.runtime.onMessage.addListener((m) => { try { globalThis.__g8.push(JSON.parse(JSON.stringify(m))); } catch (_) {} });
  }
  return true;
})()`);
const ricevuti = (esegui) => esegui('JSON.stringify(globalThis.__g8 || [])').then((s) => JSON.parse(s));

test('reset delle impostazioni e cambio dal main: al sito arrivano ritagliate', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(({ k, p }) => window.filoShell.message({
    type: 'update_settings',
    settings: { apiKeys: { openrouter: k }, proxy: { datacenter: `socks5://u:${p}@gate.example.com:7000` } },
  }), { k: CHIAVE, p: PWD });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const esegui = nelSito(app, new URL(web.url()).host);
  await ascolta(esegui);

  await shell.evaluate(() => window.filoShell.message({ type: 'reset_settings' }));
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(async () => (await ricevuti(esegui)).filter((m) => m.type === 'settings_updated').length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const tutto = JSON.stringify(await ricevuti(esegui));
  expect(tutto).not.toContain(CHIAVE);
  expect(tutto).not.toContain(PWD);
  expect(tutto).toContain('"theme":"dark"');
});

