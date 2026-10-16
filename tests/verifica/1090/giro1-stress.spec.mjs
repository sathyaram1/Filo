// Verifica #1090, giro 1: il menu riusato sotto stress (aperture in raffica, più finestre, sfocatura, scorciatoie).

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

test('due menu chiesti in raffica: resta il secondo, e la sua voce funziona', async ({ app, openTab }) => {
  await pronto(app, openTab);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    win.webContents.send('shell:trigger-button', { command: 'settings' });
    win.webContents.send('shell:trigger-button', { command: 'apps' });
  });
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 400));
  const menu = await menuAperto(app);
  await expect(menu.locator('.menu')).toContainText('Download');
  await expect(menu.locator('.menu')).not.toContainText('Preferenze');
  expect((await statoMenu(app)).visibile).toBe(true);
  await menu.evaluate(() => [...document.querySelectorAll('button.item')].find((b) => /Download/.test(b.textContent)).click());
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://downloads/'); } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
});

test('dieci aperture non moltiplicano gli ascoltatori: un tasto nel menu agisce una volta', async ({ app, openTab }) => {
  await pronto(app, openTab);
  const prima = await statoMenu(app);
  for (let k = 0; k < 10; k++) {
    await premi(app, k % 2 ? 'apps' : 'settings');
    await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
    await esc(app);
    await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(false);
  }
  const dopo = await statoMenu(app);
  expect(dopo.id).toBe(prima.id);
  expect(dopo.tasti).toBe(prima.tasti);
  expect(dopo.ipc).toBe(prima.ipc);
});

test('il menu si chiude quando il fuoco torna alla finestra, e si riapre', async ({ app, openTab }) => {
  await pronto(app, openTab);
  await premi(app, 'settings');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 300));
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    m.blur();
    m.emit('blur');
  });
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 3000 }).toBe(false);
  await premi(app, 'apps');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Download');
});

test('con la finestra incognito: ognuna il suo menu, uno solo in vista, e chiuderla non rompe l\'altra', async ({ app, shell, openTab }) => {
  await pronto(app, openTab);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(async () => { const m = await statoMenu(app, true); return !!m && m.carica; }, { timeout: 15000 }).toBe(true);
  const normale = await statoMenu(app);
  const incog = await statoMenu(app, true);
  expect(incog.id).not.toBe(normale.id);

  await premi(app, 'settings');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await premi(app, 'settings', true);
  await expect.poll(async () => (await statoMenu(app, true)).visibile, { timeout: 5000 }).toBe(true);
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 3000 }).toBe(false);

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close(); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 8000 }).toBe(false);
  await premi(app, 'apps');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Download');
});
