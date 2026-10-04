import { test, expect } from './fixtures/electron.mjs';

const gesto = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const t = tm.tabs.find((x) => { try { return new URL(x.view.webContents.getURL()).hostname === h; } catch (_) { return false; } });
  return t ? (t.view.webContents._filoGestoAlle || 0) : -1;
}, host);

test('esperimento', async ({ app, openTab, testServer, shell }) => {
  const dentro = testServer.html('<button id="b" style="width:200px;height:80px">dentro</button>', { pubblico: true });
  const url = testServer.html(`<title>FS</title><iframe id="f" src="${dentro}" width="400" height="200"></iframe>
  <script>window.__fs='niente';setTimeout(()=>{document.documentElement.requestFullscreen().then(()=>{window.__fs='ok'},(e)=>{window.__fs='err:'+e.message})},800);</script>`);
  const page = await openTab(url);
  await page.waitForTimeout(2000);
  const fs = await page.evaluate(() => [window.__fs, !!document.fullscreenElement]);
  console.log('FS senza gesto:', JSON.stringify(fs));
  await page.evaluate(() => document.exitFullscreen && document.fullscreenElement && document.exitFullscreen()).catch(() => {});
  await page.waitForTimeout(800);
  const prima = await gesto(app, '127.0.0.1');
  console.log('gesto prima', prima);
  const frame = page.frames().find((f) => f.url() === dentro);
  await frame.locator('#b').click();
  await page.waitForTimeout(300);
  const dopo = await gesto(app, '127.0.0.1');
  console.log('gesto dopo clic nel riquadro', dopo, 'diverso:', dopo !== prima);
  await page.mouse.click(5, 300);
  await page.waitForTimeout(300);
  console.log('gesto dopo clic sulla pagina', await gesto(app, '127.0.0.1'));
});
