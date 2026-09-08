// PROBE temporaneo — non fa parte della suite finale.
import { test, expect } from './fixtures/electron.mjs';

function readState(app) {
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

test('probe: Esc con focus sulla SHELL', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime && chrome.runtime.sendMessage), null, { timeout: 8000 });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'toggle_fullscreen' }));
  await expect.poll(async () => (await readState(app)).contentFullscreen).toBe(true);

  // Focus alla shell (barra in alto), come dopo aver usato la barra indirizzi.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.webContents.focus();
  });
  await shell.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1200));
  console.log('DOPO ESC SU SHELL:', JSON.stringify(await readState(app)));
});

test('probe: fullscreen OS senza contentFullscreen', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime), null, { timeout: 8000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    win.setFullScreen(true);
  });
  await new Promise((r) => setTimeout(r, 800));
  console.log('OS FS PRIMA:', JSON.stringify(await readState(app)));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    try { active.view.webContents.focus(); } catch (_) {}
  });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1200));
  console.log('OS FS DOPO ESC:', JSON.stringify(await readState(app)));
});

test('probe: pageFullscreen appiccicato dopo navigazione', async ({ app, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!(window.chrome && chrome.runtime), null, { timeout: 8000 });
  // Simula: la pagina entra in fullscreen HTML5 e poi naviga via senza leave.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    tabs.pageFullscreen = true;
    tabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 500));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tabs = win._filoTabs;
    const active = tabs.tabs.find((t) => t.id === tabs.activeId);
    try { active.view.webContents.focus(); } catch (_) {}
  });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 1200));
  console.log('PAGEFS DOPO ESC:', JSON.stringify(await readState(app)));
});
