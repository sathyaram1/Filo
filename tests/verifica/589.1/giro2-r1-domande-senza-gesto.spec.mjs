// #589.1 giro 2, rilievo 1 — le domande che il codice di Filo nelle pagine fa dopo un gesto dell'utente (Incolla,
// Salva per dopo, dizionario, disposizione del menu) un sito le fa da sé: legge gli appunti, sonda e spinge fuori
// le pagine salvate, cancella le personalizzazioni. Serve l'isolamento dei contesti rotto: qui lo simula il mondo 999.

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

test('il sito in vista non si dà da solo il lasciapassare di Incolla per leggere gli appunti', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>in vista</h1>');
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-segreta-123'));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.focus();
    w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId).view.webContents.focus();
  });
  const vista = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const leggi = () => sito.evaluate(async () => Promise.race([
    navigator.clipboard.readText().catch((e) => `rifiuto ${e.name}`),
    new Promise((r) => setTimeout(() => r('in attesa di una risposta'), 2500)),
  ]));
  expect(await leggi()).not.toBe('password-segreta-123');
  const r = await vista(chiedi('permesso_filo', { tipo: 'appunti' }));
  expect(r.nonTrovata || r.errore).toBeFalsy();
  expect(await leggi(), 'il sito ha letto gli appunti dell\'utente senza un suo gesto').not.toBe('password-segreta-123');
});

test('un sito di sfondo non legge una pagina salvata e non spinge fuori le pagine salvate dell\'utente', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://banca.example/estratto-conto', title: 'Estratto conto', thumbnail: 'data:image/png;base64,SEGRETO' });
  });
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const sonda = await sfondo(chiedi('save_page', { page: { url: 'https://banca.example/estratto-conto' } }));
  expect(sonda.nonTrovata || sonda.errore).toBeFalsy();
  expect.soft(JSON.stringify(sonda.risposta || {}), 'il sito ha letto titolo e miniatura di una pagina salvata').not.toContain('SEGRETO');
  await sfondo(`(async () => { for (let i = 0; i < 1000; i++) await chrome.runtime.sendMessage({ type: 'save_page', page: { url: 'https://spam.example/' + i, title: 'x' + i } }); })()`);
  const pagine = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).map((p) => p.url));
  expect(pagine, 'un sito di sfondo ha spinto fuori le pagine salvate dell\'utente').toContain('https://banca.example/estratto-conto');
});

test('un sito di sfondo non cancella la disposizione del menu né il dizionario personale', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('sn_icon_layout', { primary: ['copy', 'paste'], mio: true });
    await globalThis.SN_STORAGE.setRaw('sn_personal_dict', ['Sathya', 'Filo']);
  });
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const r = await sfondo(`chrome.storage.local.remove(['sn_icon_layout', 'sn_personal_dict'])`);
  expect(r.nonTrovata || r.errore).toBeFalsy();
  const dopo = await app.evaluate(async () => ({
    layout: await globalThis.SN_STORAGE.getRaw('sn_icon_layout', null),
    dict: await globalThis.SN_STORAGE.getRaw('sn_personal_dict', null),
  }));
  expect.soft(dopo.layout, 'un sito di sfondo ha cancellato la disposizione del menu').not.toBeNull();
  expect(dopo.dict, 'un sito di sfondo ha cancellato il dizionario personale').not.toBeNull();
});
