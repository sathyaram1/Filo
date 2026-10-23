import { test, expect } from '../../fixtures/electron.mjs';
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
test('sonda', async ({ app, openTab, testServer }) => {
  const dentro = testServer.html('<!doctype html><html><body style="margin:0;background:#cde;height:100vh">Pubblicità</body></html>', { pubblico: true });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <div style="height:300px"></div><iframe src="${dentro}" style="display:block;width:100%;height:250px;border:0"></iframe><div style="height:1200px">Articolo</div></body></html>`);
  await expect.poll(() => page.frames().length).toBeGreaterThan(1);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    tm.setContentFullscreen(true);
    const wc = tm.tabs.find((t) => t.id === tm.activeId).view.webContents;
    globalThis.__ev = [];
    wc.on('before-mouse-event', (_e, i) => { if (i.type === 'mouseMove') globalThis.__ev.push(['B', i.x, i.y, i.globalX, i.globalY]); });
    wc.on('input-event', (_e, i) => { if (i.type === 'mouseMove') globalThis.__ev.push(['I', i.x, i.y, i.globalX, i.globalY]); });
    globalThis.__cb = w.getContentBounds();
  });
  await pausa(800);
  await page.mouse.move(400, 100);
  await page.mouse.move(400, 301);
  await page.mouse.move(400, 350);
  await pausa(300);
  console.log(JSON.stringify(await app.evaluate(() => ({ ev: globalThis.__ev, cb: globalThis.__cb }))));
});
