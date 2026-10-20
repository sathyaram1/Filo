// #1054 giro 2 — a tutto schermo (un video) il menu dello strato sta sopra al contenuto, e Esc chiude il menu senza
// far uscire dallo schermo intero (#514).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

const HTML = `<!doctype html><html><body style="margin:0">
  <div id="stage" style="width:480px;height:320px;background:#000;position:relative">
    <video id="player" width="320" height="180" style="background:#111"></video>
  </div></body></html>`;

test('a tutto schermo il menu si vede sopra al video, e Esc chiude il menu restando a tutto schermo', async ({ app, shell, openTab, testServer }) => {
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const page = await testServer.openReady(openTab, HTML);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await app.evaluate(({ BrowserWindow }, tabId) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => t.id === tabId);
    return tab.view.webContents.executeJavaScript('document.getElementById("stage").requestFullscreen().catch(()=>{}); true', true);
  }, id);
  await page.waitForFunction(() => document.fullscreenElement && document.fullscreenElement.id === 'stage', null, { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.locator('#player').click({ button: 'right' });
  await expect(menuDi(page).principale).toBeVisible({ timeout: 8000 });
  const s = await statoDelloStrato(app);
  const scheda = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.find((t) => t.id === tm.activeId).view.getBounds();
  });
  expect(s.visibile && s.inCima, JSON.stringify(s)).toBe(true);
  expect(s.bounds).toEqual(scheda);
  await menuDi(page).superficie.screenshot({ path: 'tests/.shots/v1054-schermo-intero.png' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await statoDelloStrato(app)).aperto).toBe(false);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => !!document.fullscreenElement), 'resta a tutto schermo').toBe(true);
});
