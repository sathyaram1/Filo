// #589.12 giro 1, rilievo 1 — il messaggio dello stato di Filo, chiesto dal codice di Filo nella scheda di un
// sito B, non deve portargli titolo e indirizzo della pagina salvata da A (li ha dentro il messaggio della home).

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO_CONTENT_SCRIPT = 999;
const TITOLO_A = 'Conto della banca 589 stato';

function dalSito(app, host) {
  return (msg) => app.evaluate(async ({ BrowserWindow }, { h, m, mondo }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes(h));
    if (!tab) return { nonTrovata: true };
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { h: host, m: msg, mondo: MONDO_CONTENT_SCRIPT });
}

test('lo stato di Filo chiesto da un sito non contiene la pagina salvata da un altro sito', async ({ app, openTab, testServer }) => {
  const a = await testServer.openReady(
    openTab,
    `<!doctype html><html><head><title>${TITOLO_A}</title></head><body style="margin:0;height:100vh;background:#2a6"><h1>Saldo</h1></body></html>`,
  );
  const urlA = a.url();
  await a.click('body', { button: 'right', position: { x: 300, y: 200 } });
  await a.locator('.sn-menu [data-sn-icon-id="saveForLater"]').click();
  await expect(a.locator('.sn-save-confirm')).toBeVisible();

  // La home chiede il suo messaggio, come fa all'apertura: entra nella memoria di Filo.
  const home = await openTab('filo://home/home.html');
  const dallaHome = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_GENERATE_DASHBOARD, force: true });
    return JSON.stringify(r);
  });
  expect(dallaHome).toContain(TITOLO_A);

  await testServer.openReady(openTab, '<!doctype html><html><body><p>sito B</p></body></html>', { pubblico: true });
  const daB = dalSito(app, 'sito-pubblico.test');
  const M = await app.evaluate(() => globalThis.SN_MSG.MSG);
  const stato = JSON.stringify(await daB({ type: M.FILO_GET_STATE }));
  expect(stato).not.toContain(TITOLO_A);
  expect(stato).not.toContain(urlA);
});
