import { test, expect } from '../../fixtures/electron.mjs';

// Sonda: al momento in cui le altre prove del file fanno il tasto destro, i listener del contenuto sono montati?
test('sonda: pronta alle condizioni delle altre prove', async ({ openTab }) => {
  test.setTimeout(90_000);
  const esiti = {};
  let page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toBeAttached({ timeout: 10_000 });
  esiti.themeAttached = await page.evaluate(() => document.documentElement.dataset.filoContentReady || '-');
  await page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first().waitFor();
  esiti.selectButton = await page.evaluate(() => document.documentElement.dataset.filoContentReady || '-');
  page = await openTab('filo://security/security.html');
  await expect(page.locator('#sec-siteblock-blacklist')).toBeAttached({ timeout: 10_000 });
  esiti.security = await page.evaluate(() => document.documentElement.dataset.filoContentReady || '-');
  console.log('SONDA', JSON.stringify(esiti));
});
