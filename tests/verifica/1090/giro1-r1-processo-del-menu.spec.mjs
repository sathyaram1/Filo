// Verifica #1090, giro 1, rilievo 1: il menu riusato sopravvive alla morte del suo processo.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuAperto } from '../../helpers/barra.mjs';

const statoMenu = (app, incognito = false) => app.evaluate(({ BrowserWindow }, inc) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !!w._filoIncognito === inc);
  const m = win && win.getChildWindows().find((c) => {
    try { return !c.isDestroyed() && decodeURIComponent(c.webContents.getURL()).includes('popupApi'); } catch (_) { return false; }
  });
  if (!m) return null;
  return {
    id: m.id,
    visibile: m.isVisible(),
    carica: !m.webContents.isLoading(),
    tasti: m.webContents.listenerCount('before-input-event'),
    ipc: m.webContents.listenerCount('ipc-message'),
  };
}, incognito);

const premi = (app, button, incognito = false) => app.evaluate(({ BrowserWindow }, a) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !!w._filoIncognito === a.inc);
  win.webContents.send('shell:trigger-button', { command: a.button });
}, { button, inc: incognito });

const esc = (app) => app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
  m.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  m.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
});

async function pronto(app, openTab) {
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#dashControls .dash-ctrl[data-command="settings"]', { timeout: 8000 });
  await expect.poll(async () => { const m = await statoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  return home;
}

test('r1 il processo del menu muore: il clic dopo lo fa comparire lo stesso', async ({ app, openTab }) => {
  await pronto(app, openTab);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    m.webContents.forcefullyCrashRenderer();
  });
  await new Promise((r) => setTimeout(r, 1000));
  await premi(app, 'settings');
  await expect.poll(async () => { const m = await statoMenu(app); return !!m && m.visibile; }, { timeout: 5000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Preferenze');
});
