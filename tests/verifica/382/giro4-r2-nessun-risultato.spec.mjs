// #382 giro 4, rilievo 2: una ricerca a parole che Scryfall non trova deve dirlo, non fermarsi a «Cerco carte…».

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_finti.mjs';

test('ricerca a parole senza risultati: la bolla dice che non ha trovato niente', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    globalThis.__pages = [[]];
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste.', query: 'o:"gives haste"', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = () => JSON.stringify({ keep: [] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const bubble = await send(page, 'carte che danno haste', 60_000);
  await expect(bubble).toContainText(/nessun|non ho trovato|non ha trovato/i);
});
