// Verifica #2372, giro 1, rilievo 2: ridare una lettera già usata toglie in silenzio quello che apriva prima.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

async function casa(app) {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#altroPiu')).toBeVisible({ timeout: 10_000 });
  return page;
}
const urlDiY = (app) => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).doppioTocco.lettere.map((v) => v.url || v.tasto).join());

test('r2 una lettera già data, ridata a un\'altra cosa, dice cosa apriva prima (Preferenze e tasto destro)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ doppioTocco: { lettere: [{ lettera: 'y', url: 'https://www.youtube.com/' }] } }));
  const pref = await openTab('filo://preferences/preferences.html');
  await expect(pref.locator('#doppioToccoLettere .mem-riga')).toHaveCount(1);
  await pref.locator('#doppioToccoNuova').fill('y');
  await pref.locator('#doppioToccoDove').fill('example.com');
  await pref.locator('#doppioToccoAggiungi').click();
  await expect.poll(() => urlDiY(app)).toBe('https://example.com/');
  await expect.soft(pref.locator('#sec-doppio-tocco')).toContainText('youtube');

  const page = await casa(app);
  await page.locator('#altro .dash-altro-app[data-id="impostazioni"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Assegna una lettera' }).click();
  await page.keyboard.press('y');
  await expect.poll(() => urlDiY(app)).toBe('impostazioni');
  await expect(page.locator('#dashFlash')).toContainText('example.com');
});
