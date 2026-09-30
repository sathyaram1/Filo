// #382 giro 3, rilievo 4: un messaggio tutto in sintassi Scryfall è già la richiesta esatta, anche quando il
// modello della chat gli aggiunge un criterio a parole.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

test('«o:haste» mostra tutte le carte con haste nel testo anche se il modello riassume «dà haste»', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [3], relevant: [2] });
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: 'o:haste', filter: 'fa guadagnare haste ad altre creature' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'o:haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});
