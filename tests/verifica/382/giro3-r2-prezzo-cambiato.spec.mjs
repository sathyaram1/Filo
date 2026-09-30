// #382 giro 3, rilievo 2: un giudizio salvato che dipende dal prezzo non vale più quando il prezzo cambia.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_finti.mjs';

test('la stessa ricerca «sotto 1 euro» dopo un cambio di prezzo segue il prezzo di adesso', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = (id, name, eur) => ({
      id, name, mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: `${name} deals 3 damage to any target.`,
      colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/${id}.jpg` },
      prices: { eur }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    globalThis.__card = card;
    globalThis.__searchCards = [card('shock-1', 'Shock', '0.50'), card('bolt-1', 'Lightning Bolt', '2.00')];
    // Il prezzo sta nel criterio e non nella query, come chiedono le regole della chat.
    globalThis.__chat = () => JSON.stringify({ query: '(o:damage or o:deals)', filter: 'infligge danni ed è sotto 1 euro' });
    // Giudice onesto: tiene le carte che, nella riga che vede, costano meno di 1 €.
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. /.test(l)).filter((l) => {
        const m = l.match(/prezzo (\d+),(\d+) €/);
        return m && Number(`${m[1]}.${m[2]}`) < 1;
      }).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(first.locator('.dk-row-name')).toHaveText(['Shock']);

  // Tempo dopo: Shock è salito a 3 €, Lightning Bolt è sceso a 0,40 €.
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__searchCards = [card('shock-1', 'Shock', '3.00'), card('bolt-1', 'Lightning Bolt', '0.40')];
  });
  const second = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(second.locator('.dk-row-name')).toHaveText(['Lightning Bolt']);
});
