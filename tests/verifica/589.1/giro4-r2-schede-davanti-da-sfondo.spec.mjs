// #589.1 giro 4, rilievo 2 — la porta del giro 1 su un'altra domanda: da una scheda di sfondo un sito apre una scheda
// nuova davanti a quella dell'utente senza un suo gesto (il collegamento scritto dal modello, l'invito ai crediti).
// Isolamento rotto: mondo 999.

import { test, expect } from '../../fixtures/electron.mjs';

function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => (w._filoTabs?.tabs || []).map((t) => t.view.webContents));
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try {
      return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) };
    } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}
const chiedi = (tipo, extra = {}) => `chrome.runtime.sendMessage(${JSON.stringify({ type: tipo, ...extra })})`;
const schede = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const attiva = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId);
  return { attiva: w._filoTabs.activeId, url: String(attiva?.url || ''), quante: w._filoTabs.tabs.length };
});

async function sfondoEDavanti(app, openTab, testServer) {
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  await openTab(testServer.html('<h1>quella che guardo</h1><textarea>scritto a metà</textarea>'));
  return dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
}

for (const [nome, tipo, extra] of [
  ['il collegamento scritto dal modello', 'apri_collegamento_filo', { url: 'https://example.org/promo' }],
  ['l\'invito ai crediti', 'wallet_invite_open', { link: 'filo://invito/ABCD1234' }],
]) {
  test(`r2 da una scheda di sfondo ${nome} non passa davanti alla scheda che l'utente guarda`, async ({ app, openTab, testServer }) => {
    const sito = await sfondoEDavanti(app, openTab, testServer);
    const prima = await schede(app);
    expect(prima.url).toContain('127.0.0.1');
    const r = await sito(chiedi(tipo, extra));
    expect(r.nonTrovata || r.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
    await new Promise((ok) => setTimeout(ok, 800));
    const dopo = await schede(app);
    expect(dopo.attiva, `davanti all'utente c'è ${dopo.url}`).toBe(prima.attiva);
  });
}
