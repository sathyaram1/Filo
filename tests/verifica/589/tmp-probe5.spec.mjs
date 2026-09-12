// Sonda esplorativa 5 del giro 3 — NON è una prova, si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

function comeIlSito(app, url) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { pageUrl, messaggio }) => {
    const H = globalThis.__filoHandlers;
    const win = BrowserWindow.getAllWindows()[0];
    const host = new URL(pageUrl).host;
    const tab = win._filoTabs?.tabs?.find((t) => String(t.url || '').includes(host)) || null;
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : { id: 0, url: pageUrl, title: '' },
      url: pageUrl, isShell: false, win,
      wc: tab ? tab.view.webContents : null,
      frame: tab ? tab.view.webContents.mainFrame : null,
    };
    try { return await H.handleMessage(messaggio, sender); } catch (e) { return { errore: String(e) }; }
  }, { pageUrl: url, messaggio: msg });
}

test('sonda: una scheda di sfondo fotografa la scheda che l\'utente sta guardando', async ({ app, openTab, testServer }) => {
  const sito = await testServer.openReady(openTab, '<style>html,body{background:#0000ff;margin:0}</style><h1>sito</h1>');
  // Una seconda scheda, che diventa quella attiva.
  const altra = await testServer.openReady(openTab, '<style>html,body{background:#ff0000;margin:0}</style><h1>altra</h1>');
  await new Promise((r) => setTimeout(r, 1200));

  const attiva = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    return t ? t.url : '';
  });
  console.log('ATTIVA', attiva, 'SITO', sito.url(), 'ALTRA', altra.url());

  const scatto = await comeIlSito(app, sito.url())({ type: 'capture_visible_tab' });
  const dataUrl = scatto?.dataUrl || '';
  console.log('SCATTO ok?', scatto?.ok, 'len', dataUrl.length);

  // Che cosa c'è nella foto: decodifichiamo il PNG dentro una pagina viva.
  const colore = await altra.evaluate(async (u) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = u; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    const d = c.getContext('2d').getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
    return `${d[0]},${d[1]},${d[2]} (${img.width}x${img.height})`;
  }, dataUrl);
  console.log('COLORE-AL-CENTRO', colore);
  expect(true).toBe(true);
});
