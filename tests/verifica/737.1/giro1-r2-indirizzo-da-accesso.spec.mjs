import { test, expect } from '../../fixtures/electron.mjs';

const aperte = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const s = tm.tabs.map((t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } });
  const f = BrowserWindow.getAllWindows().map((w) => { try { return w.webContents.getURL(); } catch (_) { return ''; } });
  return [...s, ...f];
});

test('una pagina che apre da sola un indirizzo con la forma di un accesso viene fermata', async ({ app, openTab, testServer }) => {
  const bersaglio = testServer.html('<title>PUBBLICITA</title>') + '?client_id=a&response_type=code';
  await openTab(testServer.html(`<title>Sito</title><script>setTimeout(function(){window.open(${JSON.stringify(bersaglio)})},600)</script>`));
  await new Promise((r) => setTimeout(r, 3000));
  expect((await aperte(app)).filter((u) => u.includes('client_id=a')).length).toBe(0);
});

test('una pagina con un indirizzo da accesso che si riapre da sola non riempie lo schermo di finestre', async ({ app, openTab, testServer }) => {
  const base = testServer.html('<title>Catena</title><script>setTimeout(function(){window.open(location.href)},700)</script>');
  await openTab(base + '?client_id=a&response_type=code');
  await new Promise((r) => setTimeout(r, 4000));
  const f = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => { try { return w.webContents.getURL().includes('client_id=a'); } catch (_) { return false; } }).length);
  expect(f).toBe(0);
});
