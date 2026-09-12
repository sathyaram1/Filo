// Sonda esplorativa 2 del giro 3 — NON è una prova, si cancella.
import { test, expect } from '../../fixtures/electron.mjs';

test('sonda blob: il codice di Filo gira lì dentro?', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  await web.evaluate(() => {
    const html = '<!doctype html><meta charset="utf-8"><h1 id="q">blob</h1>';
    location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  });
  await new Promise((r) => setTimeout(r, 2500));
  const stato = await app.evaluate(async ({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        const wc = t.view.webContents;
        if (!String(wc.getURL()).startsWith('blob:')) continue;
        try {
          return await wc.executeJavaScript(
            'JSON.stringify({ready: document.documentElement.dataset.filoReady||"", cs: document.documentElement.dataset.filoContentReady||"", url: location.href})',
          );
        } catch (e) { return 'ERR ' + String(e); }
      }
    }
    return 'nessuna';
  });
  console.log('BLOB-STATO', stato);
  expect(true).toBe(true);
});

test('sonda about:blank — popup e scheda', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  await web.evaluate(() => {
    const w = window.open('about:blank', '_blank');
    try { w.document.write('<h1>vuoto</h1>'); } catch (_) {}
    window.__w = w;
  });
  await new Promise((r) => setTimeout(r, 2500));
  const urls = await app.evaluate(({ BrowserWindow }) => {
    const out = [];
    for (const w of BrowserWindow.getAllWindows()) {
      out.push({ finestra: w.webContents.getURL(), tabs: (w._filoTabs?.tabs || []).map((t) => t.url) });
    }
    return out;
  });
  console.log('ABOUT-URLS', JSON.stringify(urls, null, 1));

  const r = await app.evaluate(async ({ BrowserWindow }) => {
    const H = globalThis.__filoHandlers;
    // cerca un wc (finestra o scheda) su about:blank
    let wc = null; let win = null; let tab = null;
    for (const w of BrowserWindow.getAllWindows()) {
      for (const t of (w._filoTabs?.tabs || [])) {
        if (String(t.view.webContents.getURL()) === 'about:blank') { wc = t.view.webContents; win = w; tab = t; }
      }
      if (!wc && String(w.webContents.getURL()) === 'about:blank') { wc = w.webContents; win = w; }
    }
    if (!wc) return 'nessun about:blank';
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      url: wc.getURL(), isShell: win ? win.webContents === wc : false, win, wc, frame: wc.mainFrame || null,
    };
    const mem = await H.handleMessage({ type: 'filo_get_memory' }, sender);
    return JSON.stringify({ origine: sender.tab?.url || sender.url, mem });
  });
  console.log('ABOUT-RISPOSTA', r);
  expect(true).toBe(true);
});
