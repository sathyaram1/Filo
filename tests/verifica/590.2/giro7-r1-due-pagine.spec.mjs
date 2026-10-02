// #590.2 giro 7 — due pagine Sicurezza aperte: tornando sull'altra si vede la lista di adesso,
// e scrivendoci non si perde il sito messo nella prima.
import { test, expect } from '../../fixtures/electron.mjs';

const impostazioni = async (shell) => (await shell.evaluate(() => window.filoShell.message({ type: 'get_settings' }))).settings;
const idDi = (shell, re) => shell.evaluate(async (s) =>
  (await window.filoShell.tabs.snapshot()).tabs.filter((t) => new RegExp(s).test(t.url)).map((t) => t.id), re);

test('un sito scritto in una pagina Sicurezza si vede e resta tornando sulla seconda aperta da prima', async ({ shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: [] } } },
  }));
  const b = await openTab('filo://security/security.html');
  await b.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  const a = await openTab('filo://security/security.html');
  await a.waitForSelector('#sec-siteblock-blacklist', { timeout: 8000 });
  await a.locator('#sec-siteblock-blacklist').click();
  await a.keyboard.type('primo.test');
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 }).toEqual(['primo.test']);

  const [idB] = await idDi(shell, '^filo://security');
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), idB);
  await b.waitForTimeout(1000);
  await expect(b.locator('#sec-siteblock-blacklist')).toHaveValue(/primo\.test/, { timeout: 3000 });

  await b.locator('#sec-siteblock-blacklist').click();
  await b.keyboard.press('End');
  await b.keyboard.type('\nsecondo.test');
  await expect.poll(async () => (await impostazioni(shell)).security.siteBlock.blacklist, { timeout: 4000 })
    .toEqual(expect.arrayContaining(['primo.test', 'secondo.test']));
});
