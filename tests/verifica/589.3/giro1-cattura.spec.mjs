// Esplorazione: la foto della scheda in vista va a chi la chiede anche se non è quella in vista.

import { test, expect } from '../../fixtures/electron.mjs';

const MONDO = 999;

async function coloreAlCentro(app, dataUrl) {
  return app.evaluate(({ nativeImage }, d) => {
    const img = nativeImage.createFromDataURL(d);
    const { width, height } = img.getSize();
    const buf = img.toBitmap();
    const i = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return { b: buf[i], g: buf[i + 1], r: buf[i + 2], width, height };
  }, dataUrl);
}

test('una scheda in secondo piano ottiene la foto della scheda che l\'utente sta guardando', async ({ app, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, '<body style="margin:0;background:#0000ff;height:100vh"><h1>sito A</h1></body>');
  const urlA = a.url();
  await testServer.openReady(openTab, '<body style="margin:0;background:#ff0000;height:100vh"><h1>banca</h1></body>');
  let r = null; let c = { width: 0 };
  for (let i = 0; i < 30 && !c.width; i++) {
    await new Promise((s) => setTimeout(s, 300));
    r = await app.evaluate(async ({ webContents }, { urlA, mondo }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === urlA);
      return wc.executeJavaScriptInIsolatedWorld(mondo, [{ code: 'chrome.runtime.sendMessage({ type: "capture_visible_tab" })' }]);
    }, { urlA, mondo: MONDO });
    expect(r?.ok).toBe(true);
    c = await coloreAlCentro(app, r.dataUrl);
  }
  console.log('scheda dietro →', JSON.stringify(c));
  expect(c.r > 200 && c.b < 60, 'la foto è della scheda in vista (rossa), non di chi l\'ha chiesta').toBe(false);
});

test('il popup di accesso ottiene la foto della scheda che l\'utente sta guardando', async ({ app, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, '<body style="margin:0;background:#0000ff;height:100vh"><h1>sito A</h1></body>');
  const login = `${testServer.html('<h1>accedi</h1>')}?client_id=capv5893&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  await a.evaluate((u) => { window.open(u, '_blank', 'width=480,height=600'); }, login);
  await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('capv5893'));
    if (!w) return 'no';
    try { return await w.webContents.executeJavaScript('document.documentElement.dataset.filoContentReady || "no"'); } catch (_) { return 'no'; }
  }), { timeout: 15000 }).toBe('1');
  await testServer.openReady(openTab, '<body style="margin:0;background:#ff0000;height:100vh"><h1>banca</h1></body>');
  let r = null; let c = { width: 0 };
  for (let i = 0; i < 30 && !c.width; i++) {
    await new Promise((s) => setTimeout(s, 300));
    r = await app.evaluate(async ({ BrowserWindow }, mondo) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('capv5893'));
      return w.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: 'chrome.runtime.sendMessage({ type: "capture_visible_tab" })' }]);
    }, MONDO);
    if (!r?.ok) break;
    c = await coloreAlCentro(app, r.dataUrl);
  }
  console.log('popup →', JSON.stringify({ ok: r?.ok, error: r?.error }));
  if (r?.ok) {
    console.log('popup colore →', JSON.stringify(c));
    expect(c.r > 200 && c.b < 60, 'il popup ha la foto della scheda rossa').toBe(false);
  }
});
