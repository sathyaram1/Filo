// #382 giro 3, rilievo 1: un fornitore che risponde «troppe richieste» ai controlli in parallelo non deve
// lasciare la ricerca quasi tutta non controllata. Si asserisce la lista filtrata per intero.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

test('un fornitore che regge quattro richieste insieme: tutte le carte controllate, solo le giuste in lista', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await mockScryfall(app);
  await mockProvider(app);
  // Tre pagine di Scryfall, 525 carte, 11 gruppi al giudice; una carta giusta in ogni gruppo.
  await manyCards(app, { pages: [175, 175, 175], relevant: Array.from({ length: 11 }, (_, i) => i * 50 + 7) });
  await app.evaluate(() => { globalThis.__maxConcurrent = 4; globalThis.__judgeMs = 300; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste', 120_000);
  await expect(bubble).not.toContainText('non le ho potute controllare');
  await expect(bubble.locator('.dk-row-unchecked')).toHaveCount(0);
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(11);
});
