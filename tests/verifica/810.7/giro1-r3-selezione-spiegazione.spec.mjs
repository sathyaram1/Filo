// Verifica #810.7, giro 1, rilievo 3: selezionare il numero di carta nel suo campo lo manda subito al modello della
// spiegazione, senza altri clic; col tasto destro sulla selezione, uguale.

import { test, expect } from '../../fixtures/electron.mjs';
import { CARTE, modulo, preparaModelli, modelloFinto, superaAvviso, arrivato } from './aiuti.mjs';

const CAMPO = '<label for="c">Numero della carta</label> <input id="c" autocomplete="cc-number" style="width:280px">';

test('selezionare il numero di carta nel campo non lo manda al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo(CAMPO));
  await superaAvviso(page);
  await page.fill('#c', CARTE[0]);
  await preparaModelli(app);
  await modelloFinto(app, 'Una parola.');
  await page.locator('#c').click();
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(2500);
  expect(await arrivato(app, page), 'il numero di carta selezionato è partito verso il modello').not.toContain('4111');
});

test('tasto destro sul numero di carta selezionato: la spiegazione non lo manda al modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo(CAMPO));
  await superaAvviso(page);
  await page.fill('#c', CARTE[0]);
  await preparaModelli(app);
  await modelloFinto(app, 'Una parola.');
  await page.locator('#c').click();
  await page.keyboard.press('Control+a');
  await page.locator('#c').click({ button: 'right', position: { x: 12, y: 8 } });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect.poll(() => app.evaluate(() => (globalThis.__visti || []).length), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(await arrivato(app, page), 'il numero di carta selezionato è partito verso il modello').not.toContain('4111');
});
