import { test, expect } from '../../fixtures/electron.mjs';

function dalPreload(app, quale) {
  return (codice) => app.evaluate(async ({ BrowserWindow }, { src, codice: c }) => {
    // eslint-disable-next-line no-new-func
    const scegli = new Function('u', `return (${src})(u);`);
    const wcs = BrowserWindow.getAllWindows().flatMap((w) => [
      ...(w._filoTabs?.tabs || []).map((t) => t.view.webContents),
      ...(w._filoTabs ? [] : [w.webContents]),
    ]);
    const wc = wcs.find((x) => { try { return scegli(x.getURL()); } catch (_) { return false; } });
    if (!wc) return { nonTrovata: true };
    try { return { risposta: await wc.executeJavaScriptInIsolatedWorld(999, [{ code: c }]) }; } catch (e) { return { errore: String(e) }; }
  }, { src: quale.toString(), codice });
}
const chiedi = (tipo, extra = {}) => `chrome.runtime.sendMessage(${JSON.stringify({ type: tipo, ...extra })})`;
async function schede(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    return { attiva: w._filoTabs.activeId, full: !!w._filoTabs.contentFullscreen, tutte: w._filoTabs.tabs.map((t) => ({ id: t.id, url: String(t.url || ''), title: t.title })) };
  });
}

test('esplora', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: 'push_clipboard_entry', entry: { type: 'text', text: 'PASSWORD-SEGRETA-5891' } });
  });
  await testServer.openReady(openTab, '<title>SFONDO</title><h1>sfondo</h1>');
  await testServer.openReady(openTab, '<title>BANCA-POSTA-5891</title><h1>in vista</h1><input id=x>', { pubblico: true });
  const sfondo = dalPreload(app, (u) => u.startsWith('http://127.0.0.1'));
  const inVista = dalPreload(app, (u) => u.startsWith('http://sito-pubblico.test'));
  console.log('schede prima', JSON.stringify(await schede(app)));
  const daFilo = await shell.evaluate(() => window.filoShell.message({ type: 'get_credits' }));
  console.log('crediti da Filo', JSON.stringify(daFilo));
  console.log('award da sito', JSON.stringify(await sfondo(chiedi('credits_award_feedback'))));
  console.log('clip da sito', JSON.stringify(await sfondo(chiedi('get_clipboard_history'))).slice(0, 300));
  console.log('auth', JSON.stringify(await sfondo(chiedi('auth_status'))));
  console.log('storage', JSON.stringify(await sfondo(`chrome.storage.local.get(null)`)).slice(0, 600));
  const top = await inVista(chiedi('capture_feedback_topbar'));
  console.log('topbar', JSON.stringify(top).slice(0, 120));
  if (top.risposta?.dataUrl) {
    const fs = await import('node:fs');
    fs.mkdirSync('tests/.shots', { recursive: true });
    fs.writeFileSync('tests/.shots/topbar-589-1.png', Buffer.from(top.risposta.dataUrl.split(',')[1], 'base64'));
  }
  expect(true).toBe(true);
});
