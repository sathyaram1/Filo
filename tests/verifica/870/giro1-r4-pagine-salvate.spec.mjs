// #870 giro 1, rilievo 4 (c'era già su main): senza chiave la home dice «le tue pagine salvate sono qui»
// anche a chi non ne ha, e la carta dei suggerimenti dice «niente da suggerire».
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab } from './_comune.mjs';

test('senza chiave e senza pagine salvate, la home non indica pagine che non ci sono', async ({ app }) => {
  const page = await homeTab(app);
  const msg = page.locator('#homeMessage');
  await expect(msg).not.toHaveText('…', { timeout: 10_000 });
  const testo = (await msg.textContent()) || '';
  const voci = await page.locator('#tieni .dash-carta[data-tipo="suggerimenti"] .dash-carta-voce').count();
  if (/pagine salvate sono qui/.test(testo)) expect(voci, `la home dice «${testo}» ma non mostra pagine`).toBeGreaterThan(0);
});
