import { test, expect } from '../../fixtures/electron.mjs';

test('probe azioni', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();
  const out = await app.evaluate(async ({ BrowserWindow }, pageUrl) => {
    const H = globalThis.__filoHandlers;
    const win = BrowserWindow.getAllWindows()[0];
    const host = new URL(pageUrl).host;
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(host));
    const sender = { tab: { id: tab.id, url: tab.url, title: tab.title }, url: pageUrl, isShell: false, win, wc: tab.view.webContents, frame: tab.view.webContents.mainFrame };
    const chiedi = async (m) => { try { return JSON.stringify(await H.handleMessage(m, sender) ?? null).slice(0, 400); } catch (e) { return 'ERR ' + String(e).slice(0, 150); } };
    return {
      naviga: await chiedi({ type: 'filo_run_action', action: { type: 'NAVIGA', url: 'https://sito-attaccante.example/ciao' } }),
      pref: await chiedi({ type: 'filo_run_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'dark' } }),
      memoria_scrivi: await chiedi({ type: 'filo_run_action', action: { type: 'RICORDA', testo: 'INIEZIONE-DAL-SITO' } }),
      apri_url: await chiedi({ type: 'open_url', url: 'https://sito-attaccante.example/ciao' }),
      cattura: await chiedi({ type: 'capture_visible_tab' }),
      esporta: await chiedi({ type: 'export_data' }),
    };
  }, url);
  for (const [k, v] of Object.entries(out)) console.log('>>>', k, '=', v);
  expect(true).toBe(true);
});
