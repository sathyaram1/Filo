import { test, expect } from '../../fixtures/electron.mjs';

test('esplora: Ricarica nello stesso istante del crollo', async ({ app, openTab, testServer }) => {
  const url = testServer.html('<!DOCTYPE html><title>viva</title><p>contenuto</p>');
  await openTab(url);
  const info = await app.evaluate(async ({ BrowserWindow }, target) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.view.webContents.getURL() === target);
    const wc = tab.view.webContents;
    const t0 = Date.now();
    process.kill(wc.getOSProcessId(), 'SIGKILL');
    let n = 0;
    for (; n < 200 && !wc.isCrashed(); n++) await new Promise((r) => setTimeout(r, 1));
    return { id: tab.id, ms: Date.now() - t0, n };
  }, url);
  console.log('crollo visto dopo', JSON.stringify(info));
  await app.evaluate(async ({ BrowserWindow }, target) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tab = w._filoTabs.tabs.find((t) => t.view.webContents.getURL() === target);
    process.kill(tab.view.webContents.getOSProcessId(), 'SIGKILL');
    w._filoTabs.reload(tab.id);
  }, url).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  const stato = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.map((t) => t.view.webContents.getURL());
  });
  console.log('dopo Ricarica istantanea', JSON.stringify(stato));
  expect(true).toBe(true);
});
