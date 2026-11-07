// Esplorazione: tema scuro scelto in Filo (sistema chiaro): il fumetto nello strato sopra un sito e nella home.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');

test('scuro', async ({ app, shell, openTab, testServer }) => {
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  const home = await openTab('filo://newtab/');
  await home.waitForFunction(() => !!window.SN_SUGGERIMENTO);
  await home.locator('#sendBtn').hover();
  await expect(fumetto(home)).toHaveText('Invia');
  console.log('home', await home.evaluate(() => document.documentElement.dataset.snTheme), await fumetto(home).evaluate((e) => getComputedStyle(e).backgroundColor));

  const sito = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><p>Sito</p></body></html>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, sito);
  await strato.waitForSelector('.sn-sidebar-close', { timeout: 10_000 });
  await strato.locator('.sn-sidebar-close').hover();
  await expect(fumetto(strato)).toHaveText('Chiudi');
  console.log('strato', await strato.evaluate(() => document.documentElement.dataset.snTheme), await fumetto(strato).evaluate((e) => getComputedStyle(e).backgroundColor),
    await strato.locator('.sn-sidebar').evaluate((e) => getComputedStyle(e).backgroundColor));
  await strato.screenshot({ path: '/tmp/claude-0/-home-user-Filo/2a452da3-2895-5eea-97ac-497fca87a12d/scratchpad/strato-scuro.png' });
});
