// #382 giro 2, rilievo 2: cambiato il modello del giudice, la stessa ricerca va giudicata dal modello nuovo.
import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_mock.mjs';

test('dopo aver scelto un altro modello per il filtro, la ricerca ripetuta usa quello', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [30], relevant: [5] });
  await app.evaluate(() => {
    // Il giudice di partenza sbaglia (tiene Carta 1, che la haste la ha soltanto); quello scelto dopo no.
    const good = globalThis.__judge;
    globalThis.__judge = (prompt, model) => (/gemma/.test(model) ? good(prompt) : JSON.stringify({ keep: [1] }));
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await expect(first.locator('.dk-row-name')).toHaveText(['Carta 1']);

  // Come in Opzioni → Modelli: «Mazzi — filtro dei risultati di ricerca» passa a un altro modello.
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ models: { ...s.models, [C.ACTIONS.DECKS_SEARCH_FILTER]: 'gemma' } });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-row-name')).toHaveText(['Giusta 5']);
});
