// #2372 giro 3, rilievo 3: una richiesta a Filo che comincia con «cerca nel filo» ma chiede anche altro (un riassunto)
// apre la ricerca con tutta la frase dentro e il modello non la vede mai: la richiesta si perde.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto } from '../../helpers/chatFinta.mjs';
import { homeIntera } from '../../helpers/tastiHome.mjs';

test('r3 «cerca nel filo … e fammi un riassunto» arriva a Filo, che risponde', async ({ app }) => {
  await homeIntera(app);
  const page = await home(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await modelloFinto(app, [{ text: 'Ecco il riassunto delle orche.' }]);
  await page.locator('#input').fill('cerca nel filo cosa mi aveva detto Marco sulle orche e fammi un riassunto');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco il riassunto delle orche.' })).toBeVisible({ timeout: 10_000 });
});
