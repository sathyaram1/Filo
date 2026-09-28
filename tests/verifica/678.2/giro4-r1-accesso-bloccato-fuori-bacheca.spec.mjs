// #678.2 giro 4, rilievo 1 — fuori dalla bacheca un accesso che aspetta un browser chiuso
// non deve bloccare il pulsante che l'ha chiesto: si deve poter riaprire il browser o lasciar stare.

import { test, expect } from '../../fixtures/electron.mjs';

// Il browser di sistema è finto e non risponde mai: è il browser chiuso senza accedere.
async function browserMuto(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
  });
}

test('icona Profilo della home: dopo un accesso lasciato a metà nel browser il menu account si riapre', async ({ app, shell }) => {
  await browserMuto(app);
  await app.evaluate(({ ipcMain }) => {
    globalThis.__menu = [];
    ipcMain.removeHandler('shell:popup-menu');
    ipcMain.handle('shell:popup-menu', (_e, a) => { globalThis.__menu.push(a.entries.map((x) => x.label || x.type)); return null; });
  });
  const premiProfilo = () => app.evaluate(({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === url);
    w.webContents.send('shell:trigger-button', { command: 'account' });
  }, shell.url());
  const scegli = (azione) => app.evaluate(({ BrowserWindow }, [url, a]) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === url);
    w.webContents.send('shell:menu-action', a);
  }, [shell.url(), azione]);

  await premiProfilo();
  await expect.poll(() => app.evaluate(() => globalThis.__menu.length)).toBe(1);
  await scegli('auth-signin');
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  // Il browser è stato chiuso senza accedere: l'icona Profilo deve ancora rispondere.
  await premiProfilo();
  await expect.poll(() => app.evaluate(() => globalThis.__menu.length), { timeout: 3000 }).toBe(2);
});

test('posta delle segnalazioni: con l\'accesso in attesa del browser «Accedi» resta usabile', async ({ app, openTab }) => {
  await browserMuto(app);
  const page = await openTab('filo://feedback/feedback.html');
  await expect(page.locator('#adminSignIn')).toBeVisible({ timeout: 8_000 });
  await page.locator('#adminSignIn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  await page.waitForTimeout(500);
  // Chi ha chiuso il browser deve poterlo riaprire, invece di aspettare dieci minuti un pulsante spento.
  await expect(page.locator('#adminSignIn')).toBeEnabled({ timeout: 2000 });
});
