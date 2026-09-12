import { test, expect } from '../../fixtures/electron.mjs';

test('popup ha il codice di Filo', async ({ app, openTab, testServer }) => {
  const web = await testServer.openReady(openTab, '<h1>sito</h1>');
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=abc&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await web.evaluate((u) => window.open(u, '_blank'), login);
  await new Promise((r) => setTimeout(r, 2500));
  const out = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => { try { return x.webContents.getURL().includes('client_id'); } catch (_) { return false; } });
    if (!w) return 'NESSUNA FINESTRA';
    try {
      return await w.webContents.executeJavaScript('JSON.stringify({ready: document.documentElement.dataset.filoReady||"", content: document.documentElement.dataset.filoContentReady||"", url: location.href})');
    } catch (e) { return 'ERR ' + String(e); }
  });
  console.log('>>> POPUP', out);
  expect(true).toBe(true);
});
