import { test, expect } from '../../fixtures/electron.mjs';
test('restano vive?', async ({ app, shell, testServer }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ proxy: { datacenter: 'socks5://127.0.0.1:9' } }); });
  const a = testServer.html('<title>a</title>');
  const b = testServer.html('<title>b</title>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(() => { inc = app.windows().find((w) => w.url().includes('incognito=1')); return !!inc; }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  await inc.evaluate((u) => window.filoShell.tabs.open(u), a);
  await inc.evaluate((u) => window.filoShell.tabs.open(u), b);
  await expect.poll(() => app.windows().some((w) => w.url() === b), { timeout: 10_000 }).toBe(true);
  await app.evaluate(async ({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito && x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.url === u);
    await w._filoTabs.setTabProxy(t.id, 'US');
  }, b);
  await new Promise((r) => setTimeout(r, 2000));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito).close(); });
  await new Promise((r) => setTimeout(r, 1500));
  console.log('vive', JSON.stringify(await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => ({ url: w.getURL().slice(0, 50), inc: globalThis.__filoPermessi.incognito(w.session) })))));
});
