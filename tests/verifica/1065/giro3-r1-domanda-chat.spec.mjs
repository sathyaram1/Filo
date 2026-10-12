// Giro 3 di #1065: una domanda fatta alla chat di Filo deve comparire nella Cronologia AI, e la ricerca deve trovarla.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('r1 la domanda alla chat compare nella sua voce di Cronologia AI e la ricerca la trova', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  try {
    await modelloFinto(app, [{ text: 'Il museo apre alle nove.' }]);
    const page = await home(app);
    await chiedi(page, 'A che ora apre il museo civico?');
    await expect(page.getByText('Il museo apre alle nove.')).toBeVisible({ timeout: 20_000 });
  } finally {
    await ripristina(app);
  }
  const h = await openTab('filo://history/history.html');
  const voce = h.locator('.sn-history-item', { hasText: 'Il museo apre alle nove.' });
  await expect(voce).toHaveCount(1, { timeout: 20_000 });
  await expect(voce).toContainText('A che ora apre il museo civico?');
  await h.locator('#search').fill('museo civico');
  await expect(h.locator('.sn-history-item')).toHaveCount(1);
});
