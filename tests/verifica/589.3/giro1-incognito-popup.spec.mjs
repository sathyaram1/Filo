// Esplorazione: un'immagine salvata dal popup di accesso della finestra incognito finisce fra gli scaricamenti della finestra normale.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

test('salva immagine dal popup di accesso aperto in incognito', async ({ app, shell, testServer }) => {
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length }); res.end(PNG); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const img = `http://127.0.0.1:${srv.address().port}/foto-incognito.png`;

  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito && w._filoTabs?.tabs?.length)), { timeout: 15000 }).toBe(true);
  const sitoUrl = testServer.html('<h1>sito in incognito</h1>');
  await app.evaluate(({ BrowserWindow }, u) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(u); }, sitoUrl);
  const login = `${testServer.html(`<h1>accedi</h1><img src="${img}">`)}?client_id=incimg5893&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }, { sitoUrl, login }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => String(x.view.webContents.getURL()) === sitoUrl);
    if (!t) return false;
    try { await t.view.webContents.executeJavaScript(`window.open(${JSON.stringify(login)}, '_blank', 'width=480,height=600'); 1`, true); return true; } catch (_) { return false; }
  }, { sitoUrl, login }), { timeout: 15000 }).toBe(true);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('incimg5893'));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || "no"'); } catch (_) { return 'no'; }
  }), { timeout: 15000 }).toBe('1');
  const r = await app.evaluate(async ({ BrowserWindow }, img) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('incimg5893'));
    return w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `chrome.runtime.sendMessage({ type: "download_image", url: ${JSON.stringify(img)} })` }]);
  }, img);
  console.log('salva →', JSON.stringify(r).slice(0, 300));
  await new Promise((s) => setTimeout(s, 1500));
  const normale = ((await shell.evaluate(() => window.filoShell.message({ type: 'downloads_list' }))) || {}).items || [];
  const incog = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
    return w.webContents.executeJavaScript('window.filoShell.message({ type: "downloads_list" })');
  });
  console.log('normale →', JSON.stringify(normale.map((x) => x.filename)), ' incognito →', JSON.stringify((incog?.items || []).map((x) => x.filename)));
  expect(normale.some((x) => /foto-incognito/.test(x.filename || '')), 'lo scaricamento dell\'incognito compare nella finestra normale').toBe(false);
  await new Promise((r2) => srv.close(r2));
});
