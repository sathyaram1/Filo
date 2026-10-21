// Verifica #1448 giro 3, rilievo 1: un dato trovato resta suo quando il modello rilegge la frase cambiata, anche se la
// ricerca la scrive con altre parole o quella volta non la ripete. Un modello vero non si ripete parola per parola.

import { test, expect } from '../../fixtures/electron.mjs';
import { apri, valore, restaIlValore } from './giro3-aiuto.mjs';

test('r1 finita la frase il modello scrive la ricerca con altre parole: nessuna seconda ricerca, il valore resta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { letture: { 2: '[di soli xx][][Google P/E ratio][cerca][web]' } });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, ');
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('davvero basso per una azienda così. ');
  await expect.poll(() => app.evaluate(() => globalThis.__letture), { timeout: 8000 }).toBeGreaterThan(1);
  await restaIlValore(page, '27', 3000);
  expect(await app.evaluate(() => globalThis.__webChieste)).toHaveLength(1);
});

test('r1 finita la frase il modello non ripete il segnaposto: il valore trovato resta', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer, { letture: { 2: '[][][][nessuno]' } });
  await page.locator('#ta').click();
  await page.keyboard.type('Google ha un p/e di soli xx, ');
  await expect(valore(page, '27')).toBeVisible({ timeout: 10000 });
  await page.keyboard.type('davvero basso per una azienda così. ');
  await expect.poll(() => app.evaluate(() => globalThis.__letture), { timeout: 8000 }).toBeGreaterThan(1);
  await restaIlValore(page, '27', 3000);
});
