// Verifica #1296, giro 1, rilievo 1: un seguito mandato con un doppio Invio non deve fermare il lavoro appena affiancato.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from '../../helpers/copione.mjs';

test('r1 seguito con doppio Invio mentre Filo lavora: il lavoro arriva in fondo e il seguito ha risposta', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora un po\'. ', 'Quasi. '], ogni: 700, testo: 'Ecco il primo lavoro.' },
    { pensa: ['Il seguito. '], ogni: 100, testo: 'Ecco anche il seguito.' },
  ]);
  await page.locator('#input').fill('fammi un lavoro lungo');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('a lungo', { timeout: 6_000 });
  await page.waitForTimeout(800);
  await page.locator('#input').fill('e poi fai anche questo');
  // Due colpi di Invio ravvicinati, come un doppio clic: il secondo trova la casella già vuota.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco il primo lavoro.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco anche il seguito.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  await ripristina(app);
});
