// Verifica #590 giro 16, rilievo 6: una pagina Sicurezza rimasta aperta non deve rimettere
// indietro la lista dei siti bloccati quando si tocca un'altra sua manopola.
import { test, expect } from '../../helpers/reteFinta.mjs';

const listaSalvata = (app) => app.evaluate(async () => ((await globalThis.SN_STORAGE.getSettings()).security?.siteBlock || {}).blacklist || []);

test('due pagine Sicurezza: toccare una manopola nella seconda non cancella il sito messo in lista nella prima', async ({ app, shell }) => {
  await shell.evaluate(() => window.filoShell.tabs.open('filo://security/security.html'));
  await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://security')).length, { timeout: 8000 }).toBe(1);
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activeId);
  await shell.evaluate((i) => window.filoShell.tabs.duplicate(i), id);
  await expect.poll(() => app.windows().filter((w) => w.url().startsWith('filo://security')).length, { timeout: 8000 }).toBe(2);
  const [prima, seconda] = app.windows().filter((w) => w.url().startsWith('filo://security'));
  await prima.waitForSelector('#sec-siteblock-blacklist');
  await seconda.waitForSelector('#sec-block-popups');
  await seconda.waitForTimeout(800);

  const campo = prima.locator('#sec-siteblock-blacklist');
  await campo.scrollIntoViewIfNeeded();
  await campo.fill('blocked.test');
  await campo.dispatchEvent('change');
  await expect.poll(() => listaSalvata(app), { timeout: 4000 }).toEqual(['blocked.test']);

  await seconda.evaluate(() => {
    const c = document.getElementById('sec-block-popups');
    c.checked = !c.checked;
    c.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await seconda.waitForTimeout(1200);
  expect(await listaSalvata(app), 'il sito messo in lista è sparito senza che nessuno l\'abbia tolto').toEqual(['blocked.test']);
});
