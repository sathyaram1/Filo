// #382 giro 3, rilievo 3: quando il controllo non riesce la risposta dice «Riprova», e la bolla deve avere il tasto.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

test('controllo non riuscito: il tasto Riprova rifà la ricerca e la lista torna filtrata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [60], relevant: [7] });
  await app.evaluate(() => { globalThis.__judge = () => 'non saprei'; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble).toContainText('Riprova');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(60);
  // Il giudice torna a rispondere bene.
  await app.evaluate(() => {
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Giusta /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  await bubble.locator('[data-retry]').click({ timeout: 5_000 });
  const last = page.locator('.dk-msg-bot').last();
  await expect(last.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 30_000 });
  await expect(last.locator('.dk-row-name')).toHaveText(['Giusta 7']);
});
