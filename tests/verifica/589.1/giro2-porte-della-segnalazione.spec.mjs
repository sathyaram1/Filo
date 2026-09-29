// #589.1 giro 2 — le porte della segnalazione, ri-provate da una scheda di sfondo: rispondono tutte «rifiutato».

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

test('memoria, pagine salvate, stato della home, archivio, categorie, foto e chiusura di altre schede: rifiutate', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, '<h1>altra</h1>');
  await testServer.openReady(openTab, '<h1>sfondo</h1>', { pubblico: true });
  await testServer.openReady(openTab, '<h1>in vista</h1>');
  const sfondo = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  const altra = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return w._filoTabs.tabs.find((t) => String(t.url).includes('127.0.0.1'))?.id;
  });
  for (const [tipo, extra] of [
    ['filo_get_memory'], ['filo_memory_view'], ['get_saved_pages'], ['filo_get_state'], ['filo_generate_dashboard'],
    ['get_credits'], ['get_archived_tabs'], ['search_archived_tabs', { query: 'a' }], ['get_categories'],
    ['capture_visible_tab'], ['_tabs:query', { query: {} }], ['_tabs:remove', { id: altra }], ['focus_tab', { id: altra }],
  ]) {
    const r = await sfondo(chiedi(tipo, extra || {}));
    expect(r.nonTrovata || r.errore).toBeFalsy();
    expect(r.risposta?.code, tipo).toBe('forbidden');
  }
  const ancora = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()
    .find((x) => x._filoTabs)._filoTabs.tabs.some((t) => t.id === id), altra);
  expect(ancora).toBe(true);
});
