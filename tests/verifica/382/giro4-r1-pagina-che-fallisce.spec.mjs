// #382 giro 4, rilievo 1: una pagina di Scryfall oltre la prima che non risponde non deve far sparire le carte
// giuste dietro un «aggiungi un vincolo». Si asserisce che, anche col Riprova se Filo lo offre, arrivino tutte.

import { test, expect } from '../../fixtures/electron.mjs';
import { mockScryfall, mockProvider, manyCards, deckWithCommander, send } from './_finti.mjs';

test('pagina 2 che fallisce una volta: le carte giuste delle pagine dopo arrivano lo stesso', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175], relevant: [7, 207, 407] });
  await app.evaluate(() => {
    const pages = globalThis.__pages;
    let failed = false;
    const niv = { id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{R}', cmc: 6, type_line: 'Legendary Creature', color_identity: ['U', 'R'], colors: ['U', 'R'], prices: { eur: '1' }, legalities: { commander: 'legal' } };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        const n = Number(u.searchParams.get('page') || '1');
        if (n === 2 && !failed) { failed = true; return { ok: false, status: 503, json: async () => ({}) }; }
        return { ok: true, status: 200, json: async () => ({ data: pages[n - 1] || [], has_more: n < pages.length, total_cards: 525 }) };
      }
      if (u.pathname === '/cards/niv-1') return { ok: true, status: 200, json: async () => niv };
      if (u.pathname === '/symbology') return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  let bubble = await send(page, 'carte che danno haste', 60_000);
  // Con meno carte del tetto, «aggiungi un vincolo» è un consiglio sbagliato: le altre non le ha tagliate un tetto.
  await expect(bubble).not.toContainText('aggiungi un vincolo');
  if (await bubble.locator('[data-retry]').count()) {
    await bubble.locator('[data-retry]').click();
    bubble = page.locator('.dk-msg-bot').last();
    await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 60_000 });
  }
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  await expect(bubble).toContainText('Giusta 207');
  await expect(bubble).toContainText('Giusta 407');
});
