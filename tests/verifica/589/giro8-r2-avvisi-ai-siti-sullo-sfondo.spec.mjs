// Verifica #589 — giro 8, rilievo 2: un avviso di sistema lo mostra solo la
// scheda in primo piano, ma arriva con il suo testo anche ai siti sullo sfondo.

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

test('un avviso di sistema arriva anche ai siti sullo sfondo, che non lo mostrano', async ({ app, shell, openTab, testServer }) => {
  const sfondo = await testServer.openReady(openTab, '<h1>sito sullo sfondo</h1>');
  const esegui = nelSito(app, new URL(sfondo.url()).host);
  await ascolta(esegui);
  await openTab('http://localhost:' + new URL(testServer.origin).port + '/nessuna');

  await app.evaluate(() => {
    const H = globalThis.SN_WALLET_MAIN;
    if (H && H.outOfCreditsNotice) return H.outOfCreditsNotice({ keySource: 'own' });
    return null;
  });
  await new Promise((r) => setTimeout(r, 1500));
  const avvisi = (await ricevuti(esegui)).filter((m) => m.type === 'show_toast');
  expect(avvisi, 'l\'avviso arriva a un sito che non lo mostrerà mai').toEqual([]);
});
