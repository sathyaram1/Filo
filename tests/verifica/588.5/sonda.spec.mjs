import { test, expect } from '../../fixtures/electron.mjs';
test('sonda quando', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, '<body style="margin:0"><input id="campo" style="margin:40px"></body>');
  await app.evaluate(({ BrowserWindow, app: a, webContents }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs); const tm = win._filoTabs; win.focus(); tm.tabs.find((t) => t.id === tm.activeId).view.webContents.focus();
    globalThis.__log = []; const t0 = Date.now();
    const log = (s) => globalThis.__log.push((Date.now() - t0) + ' ' + s + ' focused=' + (webContents.getFocusedWebContents()?.getURL() || ''));
    a.on('web-contents-created', (_e, wc) => {
      log('created ' + wc.id);
      for (const ev of ['focus', 'did-start-loading', 'did-start-navigation', 'did-navigate', 'dom-ready', 'did-finish-load', 'did-stop-loading']) wc.on(ev, () => log(ev));
    });
    const orig = win.contentView.addChildView.bind(win.contentView);
    win.contentView.addChildView = (v, ...r) => { log('addChildView pre'); const x = orig(v, ...r); log('addChildView post'); return x; };
  });
  await page.locator('#campo').click();
  await shell.evaluate(() => window.filoNotify('primo', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(600);
  console.log((await app.evaluate(() => globalThis.__log)).join('\n'));
});
