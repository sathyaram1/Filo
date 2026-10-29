// #589.1 giro 5, rilievo 2 — domande che la lista ammette rispondono a un sito con ciò che non è suo: il segno con cui
// Filo firma l'utente, uguale su ogni sito, e le immagini di un altro sito lette coi cookie dell'utente.
// Isolamento rotto: mondo 999.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

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

test('r2 un sito non legge né riscrive il segno con cui Filo riconosce l\'utente su ogni sito', async ({ app, openTab, testServer }) => {
  const SEGNO = 'segno-di-questa-installazione-1234';
  await app.evaluate(async (_e, segno) => {
    await globalThis.SN_HANDLE_MESSAGE({ type: '_storage:set', obj: { sn_feedback_client_id: segno } },
      { tab: { id: 5, url: 'filo://options/options.html' }, url: 'filo://options/options.html' });
  }, SEGNO);
  await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
  await openTab(testServer.html('<h1>quella che guardo</h1>'));
  const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));

  const letto = await sito(chiedi('_storage:get', { keys: ['sn_feedback_client_id'] }));
  expect(letto.nonTrovata || letto.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
  expect(JSON.stringify(letto.risposta), 'un sito di sfondo legge il segno dell\'utente, uguale su ogni sito').not.toContain(SEGNO);

  await sito(chiedi('_storage:set', { obj: { sn_feedback_client_id: 'scelto-dal-sito' } }));
  const dopo = await app.evaluate(async () => (await globalThis.chrome.storage.local.get(['sn_feedback_client_id'])).sn_feedback_client_id);
  expect(dopo, 'un sito di sfondo sceglie il segno con cui Filo firmerà l\'utente').toBe(SEGNO);
});

test('r2 un sito non si fa portare da Filo l\'immagine di un altro sito coi cookie dell\'utente', async ({ app, openTab, testServer }) => {
  const FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
  const altro = createServer((req, res) => {
    if (!String(req.headers.cookie || '').includes('sessione=dell-utente')) { res.writeHead(403); res.end('accedi'); return; }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': FOTO.length });
    res.end(FOTO);
  });
  await new Promise((r) => altro.listen(0, '127.0.0.1', r));
  const foto = `http://127.0.0.1:${altro.address().port}/estratto-conto.jpg`;
  try {
    await testServer.openReady(openTab, '<h1>sito</h1>', { pubblico: true });
    await openTab(testServer.html('<h1>quella che guardo</h1>'));
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const wc = w._filoTabs.tabs.find((t) => t.view.webContents.getURL().startsWith('http://sito-pubblico.test')).view.webContents;
      await wc.session.cookies.set({ url, name: 'sessione', value: 'dell-utente' });
    }, foto);
    const sito = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
    const r = await sito(chiedi('image_bytes', { url: foto }));
    expect(r.nonTrovata || r.errore, 'il preload del sito non è stato raggiunto').toBeFalsy();
    expect(r.risposta?.dataUrl, 'un sito di sfondo legge un\'immagine di un altro sito, dietro l\'accesso dell\'utente').toBeFalsy();
  } finally {
    altro.closeAllConnections?.();
    await new Promise((r) => altro.close(r));
  }
});
