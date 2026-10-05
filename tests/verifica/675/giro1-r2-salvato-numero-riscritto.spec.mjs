// Verifica #675, giro 1: Gestione → Automazioni, scelte salvate a poca distanza.

import { test, expect } from '../../fixtures/electron.mjs';
import { apri, cambia } from './banco.mjs';

test('un numero riscritto dopo Salva non si vede accanto a «Salvato.»', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__delaySet = [600]; });
  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await page.locator('#mgMaxSessions').fill('9');
  await page.waitForTimeout(1200);
  const doc = await page.evaluate(() => window.__doc.maxSessions);
  expect(doc).toBe(7);
  // Il campo dice 9, il server 7: «Salvato.» lì accanto parla di un numero che non c'è.
  await expect(page.locator('#mgMaxSessionsMsg')).not.toHaveText('Salvato.');
});
