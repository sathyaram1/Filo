// Verifica #589 — giro 8, rilievo 1: la lista di ciò che arriva ai siti nomina le
// sezioni delle impostazioni; dentro una sezione ammessa passa anche il campo di domani.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO = 999;

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

test('un campo nuovo dentro una sezione ammessa non raggiunge i siti', async ({ app, shell, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const esegui = nelSito(app, new URL(web.url()).host);
  await ascolta(esegui);

  // Il prossimo segreto aggiunto dentro la sezione della voce (per esempio la
  // chiave di un servizio di sintesi a pagamento).
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { tts: { rate: 1.3, chiaveServizioVoce: 'GIRO8-SEGRETO-DENTRO-TTS' } },
  }));
  await expect.poll(async () => (await ricevuti(esegui)).filter((m) => m.type === 'settings_updated').length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
  const ultimo = (await ricevuti(esegui)).filter((m) => m.type === 'settings_updated').pop();
  expect(ultimo.settings?.tts?.rate, 'la velocità di lettura deve continuare ad arrivare al sito').toBe(1.3);
  expect(JSON.stringify(ultimo), 'un campo mai dichiarato è arrivato al sito').not.toContain('GIRO8-SEGRETO-DENTRO-TTS');
});
