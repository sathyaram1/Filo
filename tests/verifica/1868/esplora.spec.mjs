import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

for (let k = 0; k < 6; k++) {
  test(`esplora ${k}`, async ({ app, openTab, testServer }) => {
    const url = testServer.html('<!doctype html><title>viva</title><p>contenuto</p>');
    await openTab(url);
    const t0 = Date.now();
    await app.evaluate(({ webContents, BrowserWindow }, target) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === target);
      process.kill(wc.getOSProcessId(), 'SIGKILL');
    }, url);
    await expect.poll(async () => app.evaluate(() => Object.keys(globalThis.__x || {}).length + 1), { timeout: 100 }).toBe(1);
    const chiusa = createServer(() => {});
    await new Promise((r) => chiusa.listen(0, '127.0.0.1', r));
    const porta = chiusa.address().port;
    await new Promise((r) => chiusa.close(r));
    const attesa = k % 2 ? 1500 : 150;
    await new Promise((r) => setTimeout(r, attesa));
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const tm = w._filoTabs;
      tm.navigate(tm.activeId || tm.tabs[tm.tabs.length - 1].id, u);
    }, `http://127.0.0.1:${porta}/x`);
    await new Promise((r) => setTimeout(r, 2500));
    const fin = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      return w._filoTabs.tabs.map((t) => t.view.webContents.getURL().slice(0, 90));
    });
    console.log(`attesa ${attesa}ms dopo ${Date.now() - t0}:`, JSON.stringify(fin));
  });
}
