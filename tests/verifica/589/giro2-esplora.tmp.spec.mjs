// ESPLORAZIONE (temporanea).
import { test, expect } from '../../fixtures/electron.mjs';

test('sweep 2', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'Si chiama Anna, vive a MILANO-SEGRETO', PREFERENZE: 'Preferisce il tè' } } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/conto', title: 'CONTO-SEGRETO-589', text: 'saldo' } });
  });
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const url = web.url();
  await openTab(testServer.html('<h1>altra pagina</h1><title>SCHEDA-PRIVATA-589</title>'));

  const out = await app.evaluate(async ({ BrowserWindow }, pageUrl) => {
    const H = globalThis.__filoHandlers;
    const win = BrowserWindow.getAllWindows()[0];
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(new URL(pageUrl).host));
    const sender = {
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null,
      url: pageUrl,
      isShell: false,
      win,
      wc: tab ? tab.view.webContents : null,
      frame: tab ? tab.view.webContents.mainFrame : null,
    };
    const chiedi = async (msg) => {
      try { return JSON.stringify(await H.handleMessage(msg, sender) ?? null).slice(0, 1200); }
      catch (e) { return 'ERRORE ' + String(e).slice(0, 200); }
    };
    return {
      memoria: await chiedi({ type: 'filo_get_memory' }),
      stato: await chiedi({ type: 'filo_get_state' }),
      salvate: await chiedi({ type: 'get_saved_pages' }),
      esci: await chiedi({ type: 'auth_signout' }),
      authWeb: await chiedi({ type: 'auth_status' }),
    };
  }, url);
  for (const [k, v] of Object.entries(out)) console.log('>>>', k, '=', v);
  expect(true).toBe(true);
});
