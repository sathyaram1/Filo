// Verifica #589 — giro 6, rilievo 3. A un sito serve sapere solo se Filo è
// spento lì; oggi gli arriva l'elenco intero dei siti dove l'utente l'ha spento.
// La prova guarda anche che l'esclusione continui a valere sul sito escluso.

import { test, expect } from '../../fixtures/electron.mjs';

const ALTRO = 'banca-dell-utente-589.example';
const MONDO_CONTENT_SCRIPT = 999;

async function nelContentScript(app, host, code) {
  return app.evaluate(async ({ BrowserWindow }, { h, c, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.filter((t) => String(t.url || '').includes(h)).pop();
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: c }]);
  }, { h: host, c: code, mondo: MONDO_CONTENT_SCRIPT });
}

test('a un sito non arriva l\'elenco dei siti dove l\'utente ha spento Filo', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { blocklist: [d] } }), ALTRO);
  const web = await testServer.openReady(openTab, '<h1>sito qualunque</h1>');
  const host = new URL(web.url()).host;

  await nelContentScript(app, host, `
    window.__g6r3 = [];
    chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'settings_updated') window.__g6r3.push(JSON.stringify(m)); });
    true`);
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await expect.poll(() => nelContentScript(app, host, 'window.__g6r3.length'), { timeout: 8000 }).toBeGreaterThan(0);

  const spinta = await nelContentScript(app, host, 'window.__g6r3.join("\\n")');
  const letta = await nelContentScript(app, host, `chrome.runtime.sendMessage({ type: 'get_settings' }).then((r) => JSON.stringify(r))`);
  const magazzino = await nelContentScript(app, host, `chrome.storage.local.get('settings').then((r) => JSON.stringify(r))`);
  expect(spinta, 'la spinta ha portato al sito l\'elenco dei siti esclusi').not.toContain(ALTRO);
  expect(letta, 'la lettura delle impostazioni ha dato al sito l\'elenco dei siti esclusi').not.toContain(ALTRO);
  expect(magazzino, 'il magazzino ha dato al sito l\'elenco dei siti esclusi').not.toContain(ALTRO);
});

test('sul sito escluso Filo resta spento', async ({ shell, openTab, testServer }) => {
  const host = new URL(testServer.origin).hostname;
  await shell.evaluate((d) => window.filoShell.message({ type: 'update_settings', settings: { blocklist: [d, 'altro-589.example'] } }), host);
  const web = await testServer.openReady(openTab, '<h1 style="height:300px">sito escluso</h1>');
  // Da escluso il codice di Filo non arriva mai a dirsi pronto: si lascia il tempo di montarsi.
  await web.waitForTimeout(1500);
  await web.locator('h1').click({ button: 'right' });
  await web.waitForTimeout(800);
  await expect(web.locator('.sn-menu'), 'sul sito escluso il menu di Filo si è aperto').toBeHidden();
});
