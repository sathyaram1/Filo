// Sonda esplorativa 3 del giro 3 — NON è una prova, si cancella.
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

test('sonda: che cosa si porta via lo shim dello storage, per nome di chiave', async ({ app, shell, openTab, testServer }) => {
  const chiavi = await app.evaluate(() => JSON.stringify(globalThis.SN_CONST.STORAGE_KEYS));
  console.log('CHIAVI', chiavi);

  await shell.evaluate(async () => {
    const m = (x) => window.filoShell.message(x);
    await m({ type: '_storage:set', obj: { filo_memory: { PROFILO: 'MILANO-SONDA3-589' } } });
    await m({ type: 'save_page', page: { url: 'https://banca.example/c', title: 'CONTO-SONDA3-589', text: 'x' } });
    await m({ type: 'update_settings', settings: { apiKeys: { openrouter: 'sk-or-SONDA3-589' } } });
  });

  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const chiedi = comeIlSito(app, web.url());

  const tutto = await chiedi({ type: '_storage:get', keys: null });
  console.log('TUTTO', JSON.stringify(tutto).slice(0, 300));

  const mem = await chiedi({ type: '_storage:get', keys: ['filo_memory'] });
  console.log('MEMORIA-PER-NOME', JSON.stringify(mem).slice(0, 600));

  const elenco = JSON.parse(chiavi);
  const tutteLeChiavi = Object.values(elenco);
  const perNome = await chiedi({ type: '_storage:get', keys: tutteLeChiavi });
  const d = JSON.stringify(perNome);
  console.log('PER-NOME-LEN', d.length, 'segreto?', d.includes('sk-or-SONDA3-589'), 'memoria?', d.includes('MILANO-SONDA3-589'), 'conto?', d.includes('CONTO-SONDA3-589'));
  console.log('PER-NOME-CHIAVI', JSON.stringify(Object.keys(perNome?.value || {})));

  expect(true).toBe(true);
});
