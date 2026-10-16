import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!doctype html><html><head><meta charset="utf-8"><title>zoom</title></head><body><h1>una pagina</h1></body></html>';
const execAction = (app, action) =>
  app.evaluate(({ BrowserWindow }, { action }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return globalThis.SN_EXECUTE_FILO_ACTION(action, { sender: { win, wc: win.webContents, url: 'filo://newtab/' } });
  }, { action });
const fattori = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  return tm.tabs.map((t) => [t.view.webContents.getURL(), Math.round(t.view.webContents.getZoomFactor() * 100)]);
});

test('sonda tasti', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGINA);
  await page.locator('h1').click();
  await page.keyboard.press('Control+=');
  await page.keyboard.press('Control+=');
  await page.waitForTimeout(500);
  const seconda = await testServer.openReady(openTab, PAGINA);
  await seconda.waitForTimeout(1500);
  console.log('TASTI', JSON.stringify(await fattori(app)));
});

test('sonda chat', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, PAGINA);
  await execAction(app, { type: 'ZOOM_PAGINA', percentuale: 150 });
  await new Promise((r) => setTimeout(r, 500));
  const seconda = await testServer.openReady(openTab, PAGINA);
  await seconda.waitForTimeout(1500);
  console.log('CHAT', JSON.stringify(await fattori(app)));
});
