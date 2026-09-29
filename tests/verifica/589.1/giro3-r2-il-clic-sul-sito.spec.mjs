// #589.1 giro 3, rilievo 2 — il gesto che apre le domande di Incolla, del dizionario e del menu è un clic qualunque
// sul sito, non un gesto verso Filo: dopo un clic sul pulsante del sito, il sito si dà da solo il permesso di Incolla
// e legge la password copiata, e cancella dizionario e menu. Isolamento rotto: mondo 999.

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

const PAGINA = '<h1>Negozio</h1><button id="continua" style="width:300px;height:80px">Continua</button>';

async function inPrimoPiano(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.focus();
    w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents.focus();
  });
}

test('dopo un clic sul pulsante del sito, il sito non si dà il permesso di Incolla e non legge la password copiata', async ({ app, openTab, testServer }) => {
  const pagina = await testServer.openReady(openTab, PAGINA);
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  await app.evaluate(({ clipboard }) => clipboard.writeText('PASSWORD-DEL-GESTORE'));
  await inPrimoPiano(app);
  await pagina.click('#continua');
  const r = await sito(chiedi('permesso_filo', { tipo: 'appunti' }));
  expect(r.nonTrovata || r.errore).toBeFalsy();
  const letto = await pagina.evaluate(() => Promise.race([
    navigator.clipboard.readText().catch((e) => `rifiuto ${e.name}`),
    new Promise((ok) => setTimeout(() => ok('in attesa'), 2000)),
  ]));
  expect(letto, 'col clic dato al sito il sito ha letto gli appunti senza che l\'utente abbia scelto Incolla').not.toBe('PASSWORD-DEL-GESTORE');
});

test('dopo un clic sul pulsante del sito, il sito non cancella dizionario personale e disposizione del menu', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('sn_icon_layout', { primary: ['copy', 'paste'], mio: true });
    await globalThis.SN_STORAGE.setRaw('sn_personal_dict', ['Sathya', 'Filo']);
  });
  const pagina = await testServer.openReady(openTab, PAGINA);
  const sito = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  await inPrimoPiano(app);
  await pagina.click('#continua');
  const r = await sito(`chrome.storage.local.remove(['sn_icon_layout', 'sn_personal_dict'])`);
  expect(r.nonTrovata || r.errore).toBeFalsy();
  const dopo = await app.evaluate(async () => ({
    layout: await globalThis.SN_STORAGE.getRaw('sn_icon_layout', null),
    dict: await globalThis.SN_STORAGE.getRaw('sn_personal_dict', null),
  }));
  expect.soft(dopo.layout, 'col clic dato al sito il sito ha cancellato la disposizione del menu').not.toBeNull();
  expect(dopo.dict, 'col clic dato al sito il sito ha cancellato il dizionario personale').not.toBeNull();
});
