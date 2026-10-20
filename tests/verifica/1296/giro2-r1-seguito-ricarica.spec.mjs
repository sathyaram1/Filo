// Verifica #1296, giro 2, rilievo 1: un seguito in attesa non si perde se la pagina si ricarica prima che il turno finisca.
import { test, expect } from '../../fixtures/electron.mjs';
import { newtabPage, configureModel, copione, ripristina } from '../../helpers/copione.mjs';

test('r1 seguito in attesa, poi ricarica: il seguito resta (in conversazione o nella casella)', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await configureModel(app);
  await copione(app, [
    { pensa: ['Ci penso a lungo. ', 'Ancora. ', 'Ancora. ', 'Quasi. '], ogni: 800, testo: 'Prima risposta.' },
    { pensa: ['Seguito. '], ogni: 100, testo: 'Risposta al seguito.' },
  ]);
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-activity-trama').last()).toContainText('a lungo', { timeout: 6_000 });
  await page.locator('#input').fill('seguito importante');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-attesa', { hasText: 'seguito importante' })).toBeVisible({ timeout: 1_000 });
  await page.reload();
  await expect(page.locator('#input')).toBeVisible({ timeout: 15_000 });
  // Il turno di prima finisce comunque (la risposta è nell'archivio); il seguito deve esserci ancora da qualche parte.
  await expect.poll(async () => (await page.locator('#bubbles').innerText()) + '\n' + (await page.locator('#input').inputValue()),
    { timeout: 10_000 }).toContain('seguito importante');
  await ripristina(app);
});
