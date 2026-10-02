// #686.1 giro 8 — esplorazione: il clic centrale che incolla la selezione su Linux.

import { test, expect } from '../../fixtures/electron.mjs';

const HTML = '<!doctype html><html><body style="margin:0"><p id=s style="font:20px sans-serif;margin:0;padding:10px">ciaomondo</p><textarea id=t style="position:absolute;left:0;top:100px;width:400px;height:200px"></textarea></body></html>';

test('esplora: senza Filo il clic centrale incolla la selezione', async ({ app }) => {
  const v = await app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({ show: true, width: 600, height: 500, webPreferences: { sandbox: true } });
    await w.loadURL('data:text/html,' + encodeURIComponent(html));
    const wc = w.webContents;
    w.focus(); wc.focus();
    await new Promise((r) => setTimeout(r, 300));
    wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 22, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 22, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseDown', x: 40, y: 22, button: 'left', clickCount: 2 });
    wc.sendInputEvent({ type: 'mouseUp', x: 40, y: 22, button: 'left', clickCount: 2 });
    await new Promise((r) => setTimeout(r, 300));
    const sel = await wc.executeJavaScript('String(getSelection())');
    wc.sendInputEvent({ type: 'mouseDown', x: 100, y: 200, button: 'middle', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: 100, y: 200, button: 'middle', clickCount: 1 });
    await new Promise((r) => setTimeout(r, 500));
    const val = await wc.executeJavaScript('document.getElementById("t").value');
    w.destroy();
    return { sel, val };
  }, HTML);
  console.log('SENZA FILO', JSON.stringify(v));
});

test('esplora: in una scheda di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.mouse.dblclick(40, 22);
  const sel = await page.evaluate(() => String(getSelection()));
  await page.mouse.click(100, 200, { button: 'middle' });
  await page.waitForTimeout(500);
  const val = await page.evaluate(() => document.getElementById('t').value);
  const badge = await page.locator('#__filo-zoom-badge').count();
  console.log('CON FILO', JSON.stringify({ sel, val, badge }));
});
