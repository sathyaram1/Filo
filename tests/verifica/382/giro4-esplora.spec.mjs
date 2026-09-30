// #382 giro 4: esplorazione (ricerca a parole senza risultati).

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_finti.mjs';

test('ricerca a parole che Scryfall non trova', async ({ app, openTab }) => {
  test.setTimeout(120_000);
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
  console.log('TESTO-0', JSON.stringify(await bubble.innerText()));
  await page.screenshot({ path: 'tests/.shots/382-g4-zero.png' });
});
