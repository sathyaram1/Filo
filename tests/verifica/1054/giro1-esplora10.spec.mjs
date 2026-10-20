// Esplorazione del verificatore (#1054 giro 1): il menu nello strato con un video a tutto schermo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

const pausa = (ms) => new Promise((r) => { setTimeout(r, ms); });
test.use({ stratoDelMenu: true });

test('tutto schermo', async ({ app, shell, openTab, testServer }) => {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, '<!doctype html><body style="margin:0"><div id="stage" style="width:480px;height:320px;background:#000"><video id="player" width="320" height="180"></video></div></body>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await app.evaluate(({ BrowserWindow }, tabId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    return win._filoTabs.tabs.find((t) => t.id === tabId).view.webContents.executeJavaScript('document.getElementById("stage").requestFullscreen().catch(()=>{}); true', true);
  }, id);
  await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.id === 'stage', null, { timeout: 8000 });
  await pausa(1000);
  await page.locator('#player').click({ button: 'right' });
  await pausa(1500);
  const s = await statoDelloStrato(app);
  const b = await menuDi(page).principale.boundingBox().catch(() => null);
  const fs = await page.evaluate(() => !!document.fullscreenElement);
  console.log('FS', JSON.stringify({ s, b, fs, vp: await page.evaluate(() => ({ w: innerWidth, h: innerHeight })) }));
  await menuDi(page).superficie.screenshot({ path: 'tests/.shots/v1054-fs-strato.png' });
});
