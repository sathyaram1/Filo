// Esplorazione verifica #1623.3 giro 2: varianti dell'incolla mentre il riquadro nasce.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta } from '../../helpers/riquadri.mjs';

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p>Pagina che ascolta.</p><script>window.__visti=[];window.__tasti=[];`
  + `window.addEventListener('paste',(e)=>{let f=0,t='';try{f=e.clipboardData.files.length;t=e.clipboardData.getData('text/plain')}catch(_){}window.__visti.push(f+':'+t)},true);`
  + `window.addEventListener('keydown',(e)=>window.__tasti.push(e.key),true);</script></body></html>`;

async function immagine(app) {
  await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const px = Buffer.alloc(48 * 32 * 4);
    for (let i = 0; i < 48 * 32; i++) px.set([0, 0, 255, 255], i * 4);
    const png = nativeImage.createFromBitmap(px, { width: 48, height: 32 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
}

async function apriFeedbackEPremi(app, p, ms, sequenza) {
  await app.evaluate(({ BrowserWindow }, u) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.focus();
  }, p.url());
  return app.evaluate(async ({ BrowserWindow }, { u, ms: attesa, seq }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const wc = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
    wc.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_FEEDBACK_UI.open()' }]);
    if (attesa) await new Promise((r) => setTimeout(r, attesa));
    const s = win._filoTabs.riquadri?.strati?.get(wc);
    const gia = !!(s && s.pronta && s.visibile);
    for (const [k, ch, mod] of seq) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mod });
      if (ch) wc.sendInputEvent({ type: 'char', keyCode: ch, modifiers: mod });
      wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mod });
    }
    return gia;
  }, { u: p.url(), ms, seq: sequenza });
}

for (const [nome, seq] of [
  ['Shift+Insert', [['Insert', null, ['shift']]]],
  ['Ctrl+Shift+V', [['V', 'V', ['control', 'shift']]]],
]) {
  test(`immagine con ${nome} mentre nasce`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const p = await testServer.openReady(openTab, PAGINA);
    await immagine(app);
    expect(await apriFeedbackEPremi(app, p, 60, seq)).toBe(false);
    await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
    await p.waitForTimeout(1500);
    const visti = await p.evaluate(() => window.__visti);
    const thumbs = await conta(app, p, '.sn-fb-thumb');
    console.log(nome, 'sito:', JSON.stringify(visti), 'allegati:', thumbs);
    expect(visti).toEqual([]);
  });
}

for (const ms of [0, 250]) {
  test(`immagine con Ctrl+V a ${ms} ms`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const p = await testServer.openReady(openTab, PAGINA);
    await immagine(app);
    const gia = await apriFeedbackEPremi(app, p, ms, [['V', 'v', ['control']]]);
    await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
    await p.waitForTimeout(1500);
    const visti = await p.evaluate(() => window.__visti);
    const thumbs = await conta(app, p, '.sn-fb-thumb');
    console.log(ms, 'gia', gia, 'sito:', JSON.stringify(visti), 'allegati:', thumbs);
    expect(visti).toEqual([]);
    expect(thumbs).toBe(1);
  });
}

test('lettere, Ctrl+V, lettere mentre nasce: ordine e niente al sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ clipboard }) => clipboard.writeText('INCOLLATO'));
  const seq = [['A', 'a', []], ['B', 'b', []], ['V', 'v', ['control']], ['C', 'c', []]];
  expect(await apriFeedbackEPremi(app, p, 60, seq)).toBe(false);
  await expect.poll(async () => (await statoDi(app, p, '.sn-fb-text'))?.valore || '', { timeout: 10_000 }).not.toBe('');
  await p.waitForTimeout(1500);
  const valore = (await statoDi(app, p, '.sn-fb-text')).valore;
  const visti = await p.evaluate(() => window.__visti);
  console.log('testo:', JSON.stringify(valore), 'sito:', JSON.stringify(visti), 'tasti:', JSON.stringify(await p.evaluate(() => window.__tasti)));
  expect(visti).toEqual([]);
  expect(valore).toBe('abINCOLLATOc');
});

test('due Ctrl+V di fila mentre nasce: due allegati', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await immagine(app);
  expect(await apriFeedbackEPremi(app, p, 60, [['V', 'v', ['control']], ['V', 'v', ['control']]])).toBe(false);
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(1500);
  const visti = await p.evaluate(() => window.__visti);
  const thumbs = await conta(app, p, '.sn-fb-thumb');
  console.log('doppio', 'sito:', JSON.stringify(visti), 'allegati:', thumbs);
  expect(visti).toEqual([]);
});
