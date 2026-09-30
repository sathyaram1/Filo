// Esplorazione (da cancellare): persistenza, guasto parziale, testo strano, temi.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, deckWithCommander, send } from './_mock.mjs';

const judgeHammer = (prompt) => JSON.stringify({
  keep: prompt.split('\n').filter((l) => /^\d+\. Hammer of Purphoros /.test(l)).map((l) => Number(l.split('.')[0])),
});

test('persistenza: ricaricando la pagina la lista resta quella filtrata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate((j) => {
    const card = globalThis.__card;
    globalThis.__pages = [[
      card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste'),
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
    ]];
    globalThis.__chat = () => JSON.stringify({ query: '(o:haste)' });
    globalThis.__judge = eval(j);
  }, judgeHammer.toString());
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const b = await send(page, 'carte che danno haste');
  await expect(b.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bot.locator('.dk-cardlist')).not.toContainText('Goblin Guide');
});

test('guasto parziale: un lotto su tre non risponde', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    const p = [];
    for (let i = 1; i <= 120; i++) p.push(card(`c-${i}`, `Carta ${String(i).padStart(3, '0')}`, 1, 'Instant', 'Draw a card.'));
    globalThis.__pages = [p];
    globalThis.__chat = () => JSON.stringify({ query: 'o:draw', filter: 'pesca' });
    let n = 0;
    globalThis.__judge = (prompt) => {
      if (/Carta 051/.test(prompt)) return 'boh';
      return JSON.stringify({ keep: [1] });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const b = await send(page, 'carte che pescano');
  console.log('BOLLA:', await b.innerText());
  await page.screenshot({ path: 'tests/.shots/verifica-382-parziale.png' });
});

for (const tema of ['light', 'dark']) {
  test(`testo strano e nessuna tenuta, tema ${tema}`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    await mockScryfall(app);
    await mockProvider(app);
    await app.evaluate(() => {
      const card = globalThis.__card;
      globalThis.__pages = [[card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste')]];
      globalThis.__chat = () => JSON.stringify({ query: '(o:haste)' });
      globalThis.__judge = () => JSON.stringify({ keep: [] });
    });
    const page = await openTab('filo://decks/decks.html');
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForLoadState('domcontentloaded');
    await deckWithCommander(page);
    const b = await send(page, '<img src=x onerror="document.title=1"> 🔥🔥 carte che danno haste '.padEnd(300, 'x'));
    console.log('BOLLA:', await b.innerText());
    expect(await b.locator('img[src="x"]').count()).toBe(0);
    await page.screenshot({ path: `tests/.shots/verifica-382-nessuna-${tema}.png` });
  });
}
