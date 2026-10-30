import { test, expect } from '../../fixtures/electron.mjs';

test.use({ accoglienzaFatta: false, riservaNuovaScheda: true });

const homes = (app) => app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });

test('riserva della scheda nuova: chiusa l’accoglienza la scheda nuova è intera', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect.poll(() => homes(app).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const page = homes(app)[0];
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#accade .dash-carta[data-chiave="crediti"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  console.log('home iniziali', homes(app).length);
  for (const h of homes(app)) console.log('tieni hidden', await h.locator('#tieni').isHidden());
  // chiusura dell'accoglienza dal main, senza passare dalla pagina
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    const O = globalThis.SN_ONBOARDING;
    const s = await M.getOnboarding();
    await M.setOnboarding(O && O.close ? O.close(s) : { ...s, done: true });
    globalThis.SN_BROADCAST_FILO && globalThis.SN_BROADCAST_FILO({ type: globalThis.SN_MSG.MSG.FILO_ONBOARDING_UPDATED });
  });
  await page.waitForTimeout(2000);
  for (const h of homes(app)) console.log('dopo chiusura: tieni hidden', await h.locator('#tieni').isHidden());
  await shell.keyboard.press('Control+t');
  await page.waitForTimeout(3000);
  for (const h of homes(app)) console.log('dopo ctrl+t: tieni hidden', await h.locator('#tieni').isHidden(), await h.evaluate(() => document.visibilityState));
});
