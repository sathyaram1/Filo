// #589.1 giro 2 — esplorazione: le porte della segnalazione e le domande ammesse che arrivano oltre la scheda.

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

test('porte della segnalazione: da un sito rispondono tutte rifiutato', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>altra</h1>');
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const altra = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.tabs.find((t) => String(t.url).includes('127.0.0.1'))?.id;
  });
  const esiti = {};
  for (const [tipo, extra] of [
    ['filo_get_memory'], ['filo_memory_view'], ['get_saved_pages'], ['filo_get_state'], ['filo_generate_dashboard'],
    ['get_credits'], ['get_archived_tabs'], ['search_archived_tabs', { query: 'a' }], ['get_categories'],
    ['capture_visible_tab'], ['_tabs:query', { query: {} }], ['_tabs:remove', { id: altra }], ['focus_tab', { id: altra }],
  ]) {
    const r = await sfondo(chiedi(tipo, extra || {}));
    esiti[tipo] = r.risposta;
  }
  console.log(JSON.stringify(esiti).slice(0, 2000));
  for (const [tipo, r] of Object.entries(esiti)) expect(r?.code, tipo).toBe('forbidden');
  const ancora = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.some((t) => t.id === id), altra);
  expect(ancora).toBe(true);
});

test('lasciapassare: una scheda di sfondo si dà il microfono da sola', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const prima = await sito.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  const r = await sfondo(chiedi('permesso_filo', { tipo: 'media' }));
  const dopo = await sito.evaluate(async () => (await navigator.permissions.query({ name: 'microphone' })).state);
  console.log('microfono', prima, JSON.stringify(r), dopo);
  expect(dopo, 'una scheda di sfondo si è data il microfono senza che l\'utente lo chiedesse').not.toBe('granted');
});

test('lasciapassare: il sito in vista legge gli appunti senza gesto', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<h1>in vista</h1>', { pubblico: true });
  await app.evaluate(({ clipboard }) => clipboard.writeText('password-segreta-123'));
  const vista = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const senza = await sito.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return `ERR ${e.name}`; } });
  await vista(chiedi('permesso_filo', { tipo: 'appunti' }));
  const con = await sito.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return `ERR ${e.name}`; } });
  console.log('appunti', senza, '|', con);
  expect(con, 'il sito ha letto gli appunti dell\'utente senza un suo gesto').not.toBe('password-segreta-123');
});

test('pagine salvate: un sito di sfondo le spinge fuori e ne legge una', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://banca.example/estratto-conto', title: 'Estratto conto', thumbnail: 'data:image/png;base64,SEGRETO' });
  });
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const sonda = await sfondo(chiedi('save_page', { page: { url: 'https://banca.example/estratto-conto' } }));
  console.log('sonda', JSON.stringify(sonda).slice(0, 300));
  const r = await sfondo(`(async () => { let n = 0; for (let i = 0; i < 1000; i++) { const x = await chrome.runtime.sendMessage({ type: 'save_page', page: { url: 'https://spam.example/' + i, title: 'x' + i } }); if (x && x.ok) n++; } return n; })()`);
  console.log('salvate dal sito', JSON.stringify(r));
  const restano = await app.evaluate(async () => (await globalThis.SN_SAVED_PAGES.list()).some((p) => p.url === 'https://banca.example/estratto-conto'));
  expect(JSON.stringify(sonda.risposta || {}), 'il sito ha letto la miniatura di una pagina salvata').not.toContain('SEGRETO');
  expect(restano, 'un sito di sfondo ha spinto fuori le pagine salvate dell\'utente').toBe(true);
});

test('magazzino: un sito di sfondo riscrive la disposizione del menu e il dizionario', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw('sn_icon_layout', { primary: ['copy', 'paste'], mio: true });
    await globalThis.SN_STORAGE.setRaw('sn_personal_dict', ['Sathya', 'Filo']);
  });
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const letto = await sfondo(`chrome.storage.local.get(['sn_personal_dict'])`);
  await sfondo(`chrome.storage.local.remove(['sn_icon_layout', 'sn_personal_dict'])`);
  const dopo = await app.evaluate(async () => ({
    layout: await globalThis.SN_STORAGE.getRaw('sn_icon_layout', null),
    dict: await globalThis.SN_STORAGE.getRaw('sn_personal_dict', null),
  }));
  console.log('magazzino', JSON.stringify(letto), JSON.stringify(dopo));
  expect(dopo.layout, 'un sito di sfondo ha cancellato la disposizione del menu').not.toBeNull();
});
