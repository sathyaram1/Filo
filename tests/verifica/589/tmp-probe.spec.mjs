// Sonda esplorativa del giro 3 — NON è una prova, si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

// Ricostruisce il mittente ESATTAMENTE come fa il canale IPC di Filo
// (senderInfo in src/main/ipc.js), partendo dal webContents vero.
function comeQuelWebContents(app) {
  return (trova, msg) => app.evaluate(async ({ BrowserWindow }, { trovaSrc, messaggio }) => {
    const H = globalThis.__filoHandlers;
    // eslint-disable-next-line no-new-func
    const pick = new Function('BrowserWindow', `return (${trovaSrc})(BrowserWindow);`);
    const wc = pick(BrowserWindow);
    if (!wc) return { errore: 'webContents non trovato' };
    let win = BrowserWindow.fromWebContents(wc);
    let tab = null;
    if (win?._filoTabs) tab = win._filoTabs.tabs.find((t) => t.view.webContents === wc);
    if (!tab) {
      for (const w of BrowserWindow.getAllWindows()) {
        const t = w._filoTabs?.tabs?.find((tt) => tt.view.webContents === wc);
        if (t) { tab = t; win = w; break; }
      }
    }
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      url: wc.getURL(),
      isShell: win ? win.webContents === wc : false,
      win: win || null,
      isIncognito: !!win?._filoIncognito,
      wc,
      frame: wc.mainFrame || null,
    };
    try {
      const r = await H.handleMessage(messaggio, sender);
      return { origine: sender.tab?.url || sender.url || '', risposta: r };
    } catch (e) { return { origine: sender.tab?.url || sender.url || '', errore: String(e) }; }
  }, { trovaSrc: trova, messaggio: msg });
}

test('sonda blob:', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    await window.filoShell.message({
      type: '_storage:set',
      obj: { filo_memory: { PROFILO: 'MILANO-SONDA-589' } },
    });
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const prima = web.url();

  // Il sito si porta da solo su un indirizzo blob: che ha creato lui.
  await web.evaluate(() => {
    const html = '<!doctype html><meta charset="utf-8"><h1 id="q">blob</h1>';
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    location.href = u;
  });
  await new Promise((r) => setTimeout(r, 2500));

  const urls = await app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        out.push({ tabUrl: t.url, wcUrl: t.view.webContents.getURL() });
      }
      out.push({ finestra: w.webContents.getURL() });
    }
    return out;
  });
  console.log('URLS', JSON.stringify(urls, null, 1), 'prima:', prima);

  const chiedi = comeQuelWebContents(app);
  const trovaBlob = `(BrowserWindow) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        if (String(t.view.webContents.getURL()).startsWith('blob:')) return t.view.webContents;
      }
    }
    return null;
  }`;
  const memoria = await chiedi(trovaBlob, { type: 'filo_get_memory' });
  console.log('MEMORIA-DA-BLOB', JSON.stringify(memoria));
  const uscita = await chiedi(trovaBlob, { type: 'auth_signout' });
  console.log('USCITA-DA-BLOB', JSON.stringify(uscita));

  expect(true).toBe(true);
});
