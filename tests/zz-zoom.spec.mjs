import { test, expect } from './fixtures/electron.mjs';
const INNER = `<!doctype html><html><body style="margin:0;padding:0;font:14px system-ui;background:#111;color:#eee">
  <div id="t" style="position:absolute;left:100px;top:40px;width:20px;height:20px;background:#0f0"></div></body></html>`;
function outer(src) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#faf7f2">
    <iframe id="embed" src="${src}" width="520" height="110" style="border:0;position:absolute;left:60px;top:50px"></iframe>
    <div style="height:900px"></div></body></html>`;
}
for (const zoom of [1, 1.5]) {
  test(`misure zoom ${zoom}`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, outer(testServer.html(INNER)));
    await app.evaluate(({ BrowserWindow }, z) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      const t = win._filoTabs.tabs[win._filoTabs.tabs.length - 1];
      t.view.webContents.setZoomFactor(z);
      globalThis.__cmParams = null;
      t.view.webContents.on('context-menu', (_e, p) => { globalThis.__cmParams = { x: p.x, y: p.y, zoom: t.view.webContents.getZoomFactor() }; });
    }, zoom);
    await page.waitForTimeout(400);
    await page.frameLocator('#embed').locator('#t').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });
    const params = await app.evaluate(() => globalThis.__cmParams);
    const r = await page.evaluate(() => {
      const m = document.querySelector('.sn-menu').getBoundingClientRect();
      return { menuLeft: m.left, menuTop: m.top, dpr: window.devicePixelRatio, innerW: window.innerWidth };
    });
    console.log(`Z=${zoom} params=${JSON.stringify(params)} top=${JSON.stringify(r)} attesoCss={x:170,y:100}`);
  });
}
