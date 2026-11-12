// Verifica #1623.3 giro 1: un'immagine data al feedback aperto su un sito non arriva al sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { nelMondoDiFilo, statoDi, clicca, paginaDelloStrato, conta } from '../../helpers/riquadri.mjs';
import * as Gesti from '../../helpers/gestiVeri.mjs';

// PNG 1x1 rosso.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

const SPIA = `<script>
  window.__visti = [];
  const annota = (e) => {
    const dt = e.clipboardData || e.dataTransfer;
    let files = 0; let tipi = '';
    try { files = dt ? dt.files.length : 0; tipi = dt ? Array.from(dt.types).join(',') : ''; } catch (_) {}
    let items = 0;
    try { items = dt ? Array.from(dt.items).filter((i) => i.kind === 'file').length : 0; } catch (_) {}
    window.__visti.push({ t: e.type, files, items, tipi });
  };
  for (const t of ['paste', 'drop', 'dragenter', 'dragover']) { window.addEventListener(t, (e) => { annota(e); if (t !== 'paste') e.preventDefault(); }, true); document.addEventListener(t, annota, true); }
</script>`;
const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p>Pagina che ascolta.</p>${corpo}${SPIA}</body></html>`;

const conFile = (app, p) => p.evaluate(() => window.__visti.filter((v) => v.files || v.items));
const visti = (p) => p.evaluate(() => window.__visti.map((v) => `${v.t}:${v.files}/${v.items}`));

async function immagineNegliAppunti(app) {
  await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const w = 48, h = 32;
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([0, 0, 255, 255], i * 4);
    const png = nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
}

test('incolla col Ctrl+V nella casella del feedback: entra fra gli allegati e il sito non riceve niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  await immagineNegliAppunti(app);
  const strato = await clicca(app, p, '.sn-fb-text');
  await strato.keyboard.press('Control+V');
  await expect.poll(() => conta(app, p, '.sn-fb-thumbs > *'), { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await visti(p)).toEqual([]);
});

test('Ctrl+V appena aperto il feedback (strato ancora freddo): l\'immagine non va al sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await immagineNegliAppunti(app);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u);
    const wc = tab.view.webContents;
    wc.focus();
    const t0 = Date.now();
    wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_FEEDBACK_UI.open()' }]);
    let pronto = null;
    let premuto = null;
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const s = win._filoTabs.riquadri?.strati?.get(wc);
      if (pronto === null && s && s.pronta && s.visibile) pronto = Date.now() - t0;
      if (premuto === null && Date.now() - t0 >= 150) {
        premuto = Date.now() - t0;
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'char', keyCode: 'v', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
      }
      if (pronto !== null && premuto !== null) break;
    }
    return { pronto, premuto };
  }, p.url()).then((t) => console.log('freddo: tempi', JSON.stringify(t)));
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(1500);
  const allegati = await conta(app, p, '.sn-fb-thumbs > *');
  const sito = await visti(p);
  console.log('freddo: allegati', allegati, 'sito', JSON.stringify(sito));
  expect(sito, 'il sito ha ricevuto l\'incolla').toEqual([]);
});

test('una foto scaricata trascinata dall\'avviso sul feedback: entra fra gli allegati e il sito non la riceve', async ({ app, openTab, testServer, avvisi }) => {
  test.skip(!Gesti.disponibili(), 'servono i gesti veri del sistema (Linux con X)');
  test.setTimeout(120_000);
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length, 'Content-Disposition': 'attachment; filename="foto-1623.png"' });
    res.end(PNG);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const p = await testServer.openReady(openTab, pagina(`<a id="foto" href="http://127.0.0.1:${srv.address().port}/foto-1623.png">foto</a>`));
    await p.locator('#foto').click();
    const vista = await avvisi();
    const carta = vista.locator('.shell-notif[data-trascina="1"]').last();
    await expect(carta).toBeVisible({ timeout: 15_000 });
    await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => statoDi(app, p, '.sn-fb-modal')).not.toBeNull();
    const strato = await paginaDelloStrato(app, p);
    await Gesti.finestraASchermo(app);
    const daBox = await carta.boundingBox();
    const o = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const cb = w.getContentBounds();
      const vb = w._filoTabs.avvisi.vista.getBounds();
      return { x: cb.x + vb.x, y: cb.y + vb.y };
    });
    const da = { x: Math.round(o.x + daBox.x + daBox.width / 2), y: Math.round(o.y + daBox.y + daBox.height / 2) };
    const a = await Gesti.sulloSchermo(app, p, strato, '.sn-fb-text');
    await p.evaluate(() => { window.__visti.length = 0; });
    Gesti.trascina(da, a);
    await p.waitForTimeout(1500);
    const allegati = await conta(app, p, '.sn-fb-thumbs > *');
    const sito = await visti(p);
    console.log('trascina: da', JSON.stringify(da), 'a', JSON.stringify(a), 'allegati', allegati, 'sito', JSON.stringify(sito));
    expect(await conFile(app, p), 'il sito ha ricevuto il file').toEqual([]);
    expect(allegati, 'la foto entra fra gli allegati').toBeGreaterThan(0);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
