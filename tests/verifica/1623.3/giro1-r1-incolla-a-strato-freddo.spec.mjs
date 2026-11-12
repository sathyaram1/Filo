// Verifica #1623.3 giro 1, rilievo 1: Ctrl+V premuto mentre il riquadro sopra il sito sta ancora nascendo va al sito,
// non al riquadro. La prima apertura su una pagina tarda qualche decimo: lì l'immagine negli appunti la riceve la pagina.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, paginaDelloStrato, conta } from '../../helpers/riquadri.mjs';

const SPIA = `<script>
  window.__visti = [];
  const annota = (e) => {
    let files = 0;
    try { files = e.clipboardData ? e.clipboardData.files.length : 0; } catch (_) {}
    window.__visti.push(e.type + ':' + files);
  };
  window.addEventListener('paste', annota, true);
</script>`;
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p>Pagina che ascolta gli incolla.</p>${SPIA}</body></html>`;

async function immagineNegliAppunti(app) {
  await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const w = 48, h = 32;
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([0, 0, 255, 255], i * 4);
    const png = nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
}

// Ctrl+V sulla scheda come lo preme l'utente, `dopo` ms da quando parte `apri` (eseguita nel main).
async function ctrlVSullaScheda(app, url, dopo) {
  return app.evaluate(async ({ BrowserWindow }, { u, ms }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const wc = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
    await new Promise((r) => setTimeout(r, ms));
    const s = win._filoTabs.riquadri?.strati?.get(wc);
    const giaAschermo = !!(s && s.pronta && s.visibile);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'char', keyCode: 'v', modifiers: ['control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
    return giaAschermo;
  }, { u: url, ms: dopo });
}

const focoAllaScheda = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.focus();
}, url);

test('feedback: Ctrl+V subito dopo averlo aperto mette la foto fra gli allegati, e il sito non la riceve', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await immagineNegliAppunti(app);
  await focoAllaScheda(app, p.url());
  await app.evaluate(({ BrowserWindow }, u) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const wc = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
    wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_FEEDBACK_UI.open()' }]);
  }, p.url());
  expect(await ctrlVSullaScheda(app, p.url(), 120), 'il riquadro era già a schermo: la prova non prova la nascita').toBe(false);
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(1500);
  expect(await p.evaluate(() => window.__visti), 'il sito ha ricevuto l\'immagine incollata').toEqual([]);
  expect(await conta(app, p, '.sn-fb-thumbs > *'), 'la foto incollata non è fra gli allegati').toBeGreaterThan(0);
});

test('Aiuto: Ctrl+V subito dopo averlo aperto non porta l\'immagine al sito', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await immagineNegliAppunti(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await focoAllaScheda(app, p.url());
  shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  expect(await ctrlVSullaScheda(app, p.url(), 120), 'il pannello era già a schermo: la prova non prova la nascita').toBe(false);
  const strato = await paginaDelloStrato(app, p);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  await p.waitForTimeout(1500);
  expect(await p.evaluate(() => window.__visti), 'il sito ha ricevuto l\'immagine incollata').toEqual([]);
});
