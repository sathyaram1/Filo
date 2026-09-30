// #382 verifica giro 1: un giudice che risponde coi NOMI delle carte invece dei numeri non deve far dire
// «nessuna corrisponde», né restare scritto così per sempre: la stessa ricerca ripetuta deve tornare a funzionare.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_mock.mjs';

test('giudice coi nomi: niente falso «nessuna corrisponde», e la ricerca ripetuta non resta bloccata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__pages = [[
      card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste'),
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
    ]];
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = () => JSON.stringify({ keep: ['Hammer of Purphoros'] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await page.screenshot({ path: 'tests/.shots/verifica-382-nomi.png' });
  await expect(first).not.toContainText('nessuna corrisponde');

  // Il giudice torna a rispondere coi numeri: la stessa richiesta deve mostrare la carta giusta.
  await app.evaluate(() => {
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Hammer of Purphoros /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
  await expect(again.locator('.dk-cardlist')).not.toContainText('Goblin Guide');
});
