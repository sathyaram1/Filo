// #382 verifica giro 1: una ricerca a parole larga apposta supera la prima pagina di Scryfall (175 carte);
// le carte giuste delle pagine dopo devono arrivare al giudice e comparire, e la chat non deve dire di averle viste tutte.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_mock.mjs';

test('carte che danno haste: quella giusta a pagina 2 dei risultati larghi si vede', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    // Pagina 1: 175 creature economiche che HANNO haste (da scartare), una sola che la DÀ.
    const p1 = [card('greaves-1', 'Lightning Greaves', 2, 'Artifact — Equipment', 'Equipped creature has haste and shroud. Equip {0}')];
    for (let i = 1; i < 175; i++) p1.push(card(`hasty-${i}`, `Hasty Goblin ${i}`, 1, 'Creature — Goblin', 'Haste'));
    // Pagina 2: quelle a costo più alto, fra cui una che dà haste a tutte.
    const p2 = [
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
      card('ogre-1', 'Hasty Ogre', 4, 'Creature — Ogre', 'Haste'),
    ];
    globalThis.__pages = [p1, p2];
    globalThis.__chat = () => JSON.stringify({
      reply: 'Cerco carte che danno haste.',
      query: '(o:"gains haste" or o:"have haste" or o:haste)',
      filter: 'fa guadagnare haste ad altre creature',
    });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. (Lightning Greaves|Hammer of Purphoros) /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await page.screenshot({ path: 'tests/.shots/verifica-382-pagine.png' });
  const judged = await app.evaluate(() => globalThis.__filterCalls.join('\n'));
  // SUCCESSO: il giudice ha visto anche le carte oltre la prima pagina, e quella giusta compare.
  expect(judged).toContain('Hammer of Purphoros');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Lightning Greaves');
});

test('nessuna delle prime 175 va bene: la chat non dice «nessuna corrisponde» se ce ne sono altre non guardate', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    const p1 = [];
    for (let i = 1; i <= 175; i++) p1.push(card(`hasty-${i}`, `Hasty Goblin ${i}`, 1, 'Creature — Goblin', 'Haste'));
    const p2 = [card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.')];
    globalThis.__pages = [p1, p2];
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Hammer of Purphoros /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste a tutte le creature');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
});
