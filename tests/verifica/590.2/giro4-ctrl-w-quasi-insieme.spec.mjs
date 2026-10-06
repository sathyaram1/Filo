// Verifica #590.2 giro 4: porta ri-provata e chiusa. Scritto con la tastiera vera (dal main) e Ctrl+W premuti
// quasi insieme: la riga è salvata.
import { test, expect } from '../../fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;
const eventi = (app, lista) => app.evaluate(({ BrowserWindow }, t) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
  for (const e of t) tab.view.webContents.sendInputEvent(e);
}, lista);

for (const gap of [0, 15]) {
  test(`scritto e Ctrl+W con ${gap} ms fra Ctrl e W: la riga c'è`, async ({ app, shell, openTab }) => {
    await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [] } } } }));
    const page = await openTab('filo://security/security.html');
    await page.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.locator('#sec-siteblock-blacklist').click();
    for (const c of 'blocked.test') {
      await eventi(app, [{ type: 'keyDown', keyCode: c }, { type: 'char', keyCode: c }, { type: 'keyUp', keyCode: c }]);
      await new Promise((r) => setTimeout(r, 25));
    }
    await eventi(app, [{ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] }]);
    if (gap) await new Promise((r) => setTimeout(r, gap));
    await eventi(app, [{ type: 'keyDown', keyCode: 'W', modifiers: ['control'] }]);
    await expect.poll(async () => (await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.some((t) => t.url.startsWith('filo://security')))), { timeout: 5000 }).toBe(false);
    await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['blocked.test']);
  });
}
