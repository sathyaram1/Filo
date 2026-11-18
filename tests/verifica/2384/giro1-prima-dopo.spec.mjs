// Esplorazione: una prova scritta adesso fotografa la stessa schermata sul ramo e su main.
import { test, expect } from '../../fixtures/electron.mjs';

test('la pagina delle segnalazioni si fotografa', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v2384-segnalazioni.png' });
});
