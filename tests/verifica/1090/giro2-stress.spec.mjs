// Verifica #1090, giro 2: il menu riusato con la tastiera, in raffica senza attese, con la finestra madre chiusa a menu aperto.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuAperto } from '../../helpers/barra.mjs';

const statoMenu = (app, incognito = false) => app.evaluate(({ BrowserWindow }, inc) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !!w._filoIncognito === inc);
  const m = win && win.getChildWindows().find((c) => {
    try { return !c.isDestroyed() && decodeURIComponent(c.webContents.getURL()).includes('popupApi'); } catch (_) { return false; }
  });
  return m ? { id: m.id, visibile: m.isVisible(), carica: !m.webContents.isLoading(), finestre: BrowserWindow.getAllWindows().length } : null;
}, incognito);

const premi = (app, button, incognito = false) => app.evaluate(({ BrowserWindow }, a) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !!w._filoIncognito === a.inc);
  win.webContents.send('shell:trigger-button', { command: a.button });
}, { button, inc: incognito });

const tasto = (app, keyCode) => app.evaluate(({ BrowserWindow }, k) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
  const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
  m.webContents.sendInputEvent({ type: 'keyDown', keyCode: k });
  if (k === 'Enter') m.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  m.webContents.sendInputEvent({ type: 'keyUp', keyCode: k });
}, keyCode);

async function pronto(app, openTab) {
  const home = await openTab('filo://newtab/');
  await home.waitForSelector('#dashControls .dash-ctrl[data-command="settings"]', { timeout: 8000 });
  await expect.poll(async () => { const m = await statoMenu(app); return !!m && m.carica; }, { timeout: 8000 }).toBe(true);
  return home;
}

test('con la tastiera: frecce fino a Preferenze, Invio la apre', async ({ app, openTab }) => {
  await pronto(app, openTab);
  await premi(app, 'settings');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  const menu = await menuAperto(app);
  await expect(menu.locator('.menu')).toContainText('Preferenze');
  for (let k = 0; k < 12; k++) {
    await tasto(app, 'Down');
    const voce = await menu.evaluate(() => (document.querySelector('button.item.attiva') || {}).textContent || '');
    if (/Preferenze/.test(voce)) break;
  }
  await tasto(app, 'Enter');
  await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://preferences/'); } catch (_) { return false; } }), { timeout: 8000 }).toBe(true);
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 3000 }).toBe(false);
});

test('trenta clic senza attese: resta in vista l\'ultimo menu chiesto, in una finestra sola', async ({ app, openTab }) => {
  await pronto(app, openTab);
  const prima = await statoMenu(app);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    for (let k = 0; k < 30; k++) win.webContents.send('shell:trigger-button', { command: k % 2 ? 'apps' : 'settings' });
  });
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 500));
  const menu = await menuAperto(app);
  await expect(menu.locator('.menu')).toContainText('Download');
  expect(await menu.locator('.menu').count()).toBe(1);
  const dopo = await statoMenu(app);
  expect(dopo.id).toBe(prima.id);
  expect(dopo.finestre).toBe(prima.finestre);
  expect(dopo.visibile).toBe(true);
  await tasto(app, 'Escape');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 3000 }).toBe(false);
});

test('chiusa la finestra incognito col suo menu aperto, il menu della finestra normale si apre ancora', async ({ app, shell, openTab }) => {
  await pronto(app, openTab);
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(async () => { const m = await statoMenu(app, true); return !!m && m.carica; }, { timeout: 15000 }).toBe(true);
  await premi(app, 'settings', true);
  await expect.poll(async () => (await statoMenu(app, true)).visibile, { timeout: 5000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close(); });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 8000 }).toBe(false);
  await premi(app, 'settings');
  await expect.poll(async () => (await statoMenu(app)).visibile, { timeout: 5000 }).toBe(true);
  await expect((await menuAperto(app)).locator('.menu')).toContainText('Preferenze');
});

test('il primo clic dopo l\'avvio non aspetta la nascita del menu', async ({ app, openTab }) => {
  await pronto(app, openTab);
  const ms = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito);
    const m = win.getChildWindows().find((c) => decodeURIComponent(c.webContents.getURL()).includes('popupApi'));
    const t0 = Date.now();
    const visto = new Promise((r) => m.once('show', () => r(Date.now() - t0)));
    win.webContents.send('shell:trigger-button', { command: 'settings' });
    return Promise.race([visto, new Promise((r) => setTimeout(() => r(-1), 5000))]);
  });
  console.log(`[#1090 giro 2] primo clic: ${ms} ms`);
  expect(ms).toBeGreaterThanOrEqual(0);
  expect(ms).toBeLessThan(250);
});
