// Verifica #589 — giro 9, esplorazione: il codice di Filo dentro un popup di
// accesso aperto da un sito, quando chiede, vale come la finestra di Filo?

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO = 999;

test('popup di accesso: le domande riservate a Filo', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito con accesso</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=abc&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await web.evaluate((u) => window.open(u, '_blank'), login);
  await expect.poll(
    () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => {
      try { return w.webContents.getURL(); } catch (_) { return ''; }
    })),
    { timeout: 8000 },
  ).toContain(login);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => { try { return x.webContents.getURL().includes('client_id'); } catch (_) { return false; } });
    if (!w) return '';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || ""'); } catch (_) { return ''; }
  }), { timeout: 8000 }).toBe('1');

  const chiedi = (dove, msg) => app.evaluate(async ({ BrowserWindow }, { dove, msg, mondo, host }) => {
    let wc;
    if (dove === 'popup') {
      wc = BrowserWindow.getAllWindows().find((x) => { try { return x.webContents.getURL().includes('client_id'); } catch (_) { return false; } }).webContents;
    } else {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      wc = win._filoTabs.tabs.find((t) => String(t.url || '').includes(host)).view.webContents;
    }
    const code = `chrome.runtime.sendMessage(${JSON.stringify(msg)}).then((r) => JSON.stringify(r)).catch((e) => 'ERR ' + e)`;
    return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code }]);
  }, { dove, msg, mondo: MONDO, host: new URL(web.url()).host });

  const esiti = {};
  for (const type of ['filo_chats_list', 'downloads_list', 'wallet_state', 'filo_get_onboarding']) {
    esiti[type] = { sito: await chiedi('sito', { type }), popup: await chiedi('popup', { type }) };
  }
  console.log(JSON.stringify(esiti, null, 1));
  expect(true).toBe(true);
});
