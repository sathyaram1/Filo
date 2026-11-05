// Sonda: il tasto destro su un link verso un sito con la regola del paese, da una scheda normale, legge titolo e
// descrizione dalla connessione vera? La richiesta di rete è sostituita da una che registra la sessione usata.

import { test, expect } from '../../fixtures/electron.mjs';

test('anteprima di un link verso un sito con la regola, da una scheda normale', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await openTab(testServer.html('<a href="https://regola.test/x">link</a>'));
  const esito = await app.evaluate(async ({ BrowserWindow, session }) => {
    await globalThis.SN_FILO_MEMORY.setProxyRule('regola.test', { country: 'us' });
    const P = process.mainModule.require(require('node:path').join(process.cwd(), 'src/main/services/perContoDellaScheda.js'));
    const viste = [];
    P._dip.richiesta = async (ses, url) => {
      viste.push({ url, diretta: ses === session.defaultSession });
      return { risposta: new Response('<html><head><title>Titolo dal sito</title></head></html>', { headers: { 'content-type': 'text/html' } }) };
    };
    session.defaultSession.resolveHost = async () => ({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] });
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => /127\.0\.0\.1/.test(String(t.url || '')));
    const code = `chrome.runtime.sendMessage(${JSON.stringify({ type: 'fetch_link_meta', url: 'https://regola.test/x', proposta: false, delSito: true })})`;
    const r = await tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
    return { r, viste, proxy: tab.proxy || null };
  });
  console.log(JSON.stringify(esito));
  expect(esito.viste.filter((v) => v.diretta), 'nessuna lettura del sito con la regola dalla connessione vera').toEqual([]);
});
