// Verifica #1685 giro 2, rilievo 2: chiusa la conversazione in una home mentre un'altra home sta rispondendo dentro
// di essa, l'altra mostra la domanda e la risposta una volta sola.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

test('r2 chiusa altrove a risposta in corso: domanda e risposta non si ripetono', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Bene, grazie.', ritardoMs: 4000 }]);
  await chiedi(page, 'ciao filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo' })).toBeVisible({ timeout: 10_000 });
  await chiedi(b, 'come stai');
  await b.waitForTimeout(800);
  await shell.locator('.tab').first().click();
  await chiedi(page, '/clear');
  await shell.locator('.tab').nth(1).click();
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Bene, grazie.' }).first()).toBeVisible({ timeout: 10_000 });
  await b.waitForTimeout(1500);
  await expect(b.locator('.dash-bubble-user', { hasText: 'come stai' }), 'la domanda una volta sola').toHaveCount(1);
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Bene, grazie.' }), 'la risposta una volta sola').toHaveCount(1);
  await ripristina(app);
});
