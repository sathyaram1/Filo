// #382 giro 2, rilievo 3: una sessione di ricerche nel deck builder non deve svuotare la cronologia AI del resto di Filo.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_mock.mjs';

test('dopo quattordici ricerche larghe la traduzione di stamattina è ancora nella cronologia AI', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175, 175, 175, 175, 175], relevant: [3] });
  await app.evaluate(async () => {
    // Testo Oracle di lunghezza realistica (le carte vere ne hanno spesso di più).
    const long = ' Whenever another creature you control enters, you may pay {1}. If you do, put a +1/+1 counter on it and it gains trample until end of turn.';
    for (const p of globalThis.__pages) for (const c of p) c.oracle_text += long;
    let n = 0;
    // Criteri diversi a ogni turno, come le frasi diverse di una sessione vera: niente giudizi già in cache.
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: `fa guadagnare haste ad altre creature (${++n})` });
    await globalThis.SN_HISTORY.append({
      action: globalThis.SN_CONST.ACTIONS.TRANSLATE_PAGE || 'translate', provider: 'openrouter', model: 'x',
      input: { text: 'traduzione di stamattina' }, output: 'this morning translation', origin: 'https://example.com',
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  for (let i = 0; i < 14; i++) {
    const bubble = await send(page, `carte che danno haste ${i + 1}`, 60_000);
    await expect(bubble.locator('.dk-row-name')).toHaveText(['Giusta 3']);
  }
  const kept = await app.evaluate(async () => (await globalThis.SN_HISTORY.list())
    .some((it) => it.input && it.input.text === 'traduzione di stamattina'));
  expect(kept, 'la voce di stamattina è stata buttata per far posto ai controlli delle ricerche').toBe(true);
});
