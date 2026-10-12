// Verifica #663.6 giro 1: le prove sulla rete finta aprono Filo da sé, senza il profilo già accolto della fixture.
// Chi scrive in chat poco dopo aver messo il modello (come un utente, non nello stesso istante) trova l'intervista.
import { test, expect } from '../../helpers/reteFinta.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('r2 rete finta: modello messo a home aperta, domanda dopo due secondi, risponde la chat e non l’intervista', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  const benvenuto = await app.evaluate(() => globalThis.SN_ONBOARDING.WELCOME_MESSAGE.split('.')[0]);
  await modelloFinto(app, [{ text: 'RISPOSTA-6636' }]);
  try {
    await page.waitForTimeout(2000);
    await chiedi(page, 'apri quel link');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RISPOSTA-6636' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-bubble-filo', { hasText: benvenuto })).toHaveCount(0);
  } finally {
    await ripristina(app);
  }
});
