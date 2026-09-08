// #514 avversariale, parte 3 — chi altro voleva quell'Esc, e cosa si porta via.
import { test, expect } from './fixtures/electron.mjs';

const HTML = `<html><body style="margin:0"><p id="t">ciao</p>
<div id="box" style="width:100px;height:100px;background:#09f"></div></body></html>`;

function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    return {
      contentFullscreen: tabs.contentFullscreen,
      pageFullscreen: tabs.pageFullscreen,
      osFullscreen: win.isFullScreen(),
    };
  });
}

function premiEsc(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    const wc = active.view.webContents;
    try { wc.focus(); } catch (_) {}
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
}

test('menu del tasto destro aperto a tutto schermo: cosa fa l\'Esc', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.toggleContentFullscreen();
  });
  await expect.poll(async () => (await stato(app)).contentFullscreen).toBe(true);

  await page.locator('#t').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible({ timeout: 8000 });

  await premiEsc(app);
  await page.waitForTimeout(1200);
  const menuAncoraAperto = await page.locator('.sn-menu').isVisible();
  const s = await stato(app);
  console.log(`[porte] dopo Esc col menu aperto → fullscreen=${s.contentFullscreen} menuAperto=${menuAncoraAperto}`);
  // Cosa vorrebbe l'utente: Esc chiude il menu. Qui documento cosa succede.
  expect(menuAncoraAperto).toBe(false);
});

test('schermo intero del sistema + video a tutto schermo: l\'Esc del video porta via anche il resto', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  });
  // L'utente mette la FINESTRA a tutto schermo (su Mac: pallino verde).
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs).setFullScreen(true);
  });
  await expect.poll(async () => (await stato(app)).osFullscreen, { timeout: 8000 }).toBe(true);
  await expect.poll(async () => (await stato(app)).contentFullscreen, { timeout: 8000 }).toBe(true);

  // Poi il player del sito va a tutto schermo…
  await app.evaluate(({ BrowserWindow }) => {
    const tabs = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    return active.view.webContents.executeJavaScript(
      'document.getElementById("box").requestFullscreen().catch(()=>{}); true', true);
  });
  await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 8000 });

  // …e l'utente esce dal VIDEO con Esc.
  await premiEsc(app);
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 8000 });
  await page.waitForTimeout(1000);
  const s = await stato(app);
  console.log(`[porte] uscito dal video → osFullscreen=${s.osFullscreen} contentFullscreen=${s.contentFullscreen}`);
  // L'utente aveva messo lui la finestra a tutto schermo: uscire dal video non
  // dovrebbe portargliela via.
  expect(s.osFullscreen).toBe(true);
});
