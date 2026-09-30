// #382 giro 5: un seguito scritto in sintassi («cmc<=3» dopo «carte che danno haste») restringe la ricerca di
// prima, e la lista deve restare quella che rispetta la richiesta: la creatura che ha haste solo per sé non torna.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, hasteCards, deckWithCommander, send } from './_finti.mjs';

test('un seguito in sintassi che restringe una ricerca a parole non riporta le carte scartate', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    let n = 0;
    // Il modello fa quello che le sue regole chiedono: tiene la query di prima, aggiunge il vincolo, riscrive il criterio.
    globalThis.__chat = () => (++n === 1
      ? JSON.stringify({ reply: 'Cerco carte che danno haste.', query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' })
      : JSON.stringify({ reply: 'Restringo a costo 3 o meno.', query: '(o:"have haste" or o:haste) cmc<=3', filter: 'fa guadagnare haste ad altre creature, costo di mana 3 o meno' }));
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await expect(first.locator('.dk-row-name')).toHaveText(['Hammer of Purphoros']);

  const next = await send(page, 'cmc<=3');
  await expect(next.locator('.dk-row-name')).toHaveText(['Hammer of Purphoros']);
  await expect(next.locator('.dk-cardlist')).not.toContainText('Goblin Guide');
});
