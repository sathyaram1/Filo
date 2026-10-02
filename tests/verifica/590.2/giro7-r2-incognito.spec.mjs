// #590.2 giro 7 — un sito scritto nella pagina Sicurezza aperta dalla finestra in incognito resta nella lista.
import { test, expect } from '../../fixtures/electron.mjs';

const lista = (app) => app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()).security?.siteBlock || {}).blacklist || []);

test('Sicurezza aperta dall\'incognito: il sito scritto resta in lista anche chiusa la finestra', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [] } } },
  }));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await expect.poll(() => !!app.windows().find((w) => w.url().includes('incognito=1')), { timeout: 10_000 }).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab('filo://security/security.html'));
  let pref = null;
  await expect.poll(() => { pref = app.windows().find((w) => w.url().startsWith('filo://security')); return !!pref; }, { timeout: 10_000 }).toBe(true);
  await pref.waitForSelector('#sec-siteblock-blacklist');
  await pref.locator('#sec-siteblock-blacklist').click();
  await pref.keyboard.type('blocked.test');
  await pref.waitForTimeout(1500);
  await pref.reload();
  await pref.waitForSelector('#sec-siteblock-blacklist');
  await expect(pref.locator('#sec-siteblock-blacklist')).toHaveValue('blocked.test', { timeout: 3000 });
  console.log('disco con incognito aperto:', JSON.stringify(await lista(app)));

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => lista(app), { timeout: 3000 }).toEqual(['blocked.test']);
});
