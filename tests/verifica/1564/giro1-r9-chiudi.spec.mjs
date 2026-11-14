// Verifica #1564 giro 1, rilievo 9: «chiudi le schede» dalla chat non chiude più niente. Modello finto.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

test('r9 «chiudi tutte le schede tranne questa» con scheda(chiudi): resta solo la home con la chat', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Ricetta</title><p>ricetta'));
  await openTab(testServer.html('<title>Meteo</title><p>meteo'));
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'scheda', arguments: JSON.stringify({ azione: 'chiudi', tutte: true }) }] },
    { text: 'Fatto.' },
  ]);
  await chiedi(page, 'chiudi tutte le schede tranne questa');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 15_000 });
  console.log('DEBUG', (await page.locator('.dash-activity').allInnerTexts()).join(' | '), JSON.stringify(await app.evaluate(() => globalThis.__chatFinta_calls)).slice(-1500));
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  await ripristina(app);
});
