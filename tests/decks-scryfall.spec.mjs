// Client Scryfall del deck builder (task 2): impostare il commander risolve la
// carta via Scryfall (qui mockato: niente rete) e la libreria mostra art crop
// e pip dei colori REALI. La ricerca vincola automaticamente la query alla
// color identity del commander (§4). Il fetch è sostituito nel main con
// SN_SCRYFALL._setFetch: il test esercita servizio + handler + storage + UI.

import { test, expect } from './fixtures/electron.mjs';

// Installa nel main un fetch finto che serve una mini-API Scryfall e registra
// le richieste (per asserire il vincolo id<= sulla ricerca).
async function mockScryfall(app) {
  await app.evaluate(() => {
    const CARD = {
      id: 'niv-1',
      name: 'Niv-Mizzet, Parun',
      mana_cost: '{U}{U}{U}{R}{R}{R}',
      cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard',
      colors: ['U', 'R'],
      color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/niv',
    };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [CARD], has_more: false };
      else if (u.pathname === '/cards/niv-1') body = CARD;
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

test('impostare il commander porta art crop e pip reali nella libreria', async ({ app, openTab }) => {
  await mockScryfall(app);

  // Crea un mazzo e imposta il commander via handler (la UI arriva col task 4/5).
  const deckId = await app.evaluate(async () => {
    const { handleMessage } = require('./src/main/services/handlers.js');
    const MSG = globalThis.SN_MSG.MSG;
    const created = await handleMessage({ type: MSG.DECKS_CREATE, nome: 'Izzet' }, null);
    const r = await handleMessage({ type: MSG.DECKS_SET_COMMANDER, id: created.deck.id, scryfallId: 'niv-1' }, null);
    if (!r.ok) throw new Error('set commander fallito: ' + r.error);
    return created.deck.id;
  });

  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // La card del mazzo mostra i pip U e R (in quest'ordine WUBRG) e l'art crop.
  const card = page.locator(`[data-deck-id="${deckId}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator('.dk-pip')).toHaveCount(2);
  await expect(card.locator('.dk-pip').nth(0)).toHaveAttribute('data-c', 'U');
  await expect(card.locator('.dk-pip').nth(1)).toHaveAttribute('data-c', 'R');
  const bg = await card.locator('.dk-thumb').evaluate((el) => el.style.backgroundImage);
  expect(bg).toContain('niv-art.jpg');

  // Nel builder l'header mostra il nome del commander (identità del documento).
  await card.click();
  await expect(page.locator('#commanderLine')).toHaveText(/Niv-Mizzet, Parun/);
});

test('la ricerca è vincolata all\'identity del commander; sintassi esplicita passa invariata', async ({ app }) => {
  await mockScryfall(app);

  const { qAuto, qExplicit, cardName } = await app.evaluate(async () => {
    const { handleMessage } = require('./src/main/services/handlers.js');
    const MSG = globalThis.SN_MSG.MSG;
    const created = await handleMessage({ type: MSG.DECKS_CREATE, nome: 'Izzet' }, null);
    await handleMessage({ type: MSG.DECKS_SET_COMMANDER, id: created.deck.id, scryfallId: 'niv-1' }, null);
    globalThis.__scryRequests.length = 0;

    // Ricerca nel contesto del mazzo: id<=UR aggiunto da solo.
    const r1 = await handleMessage({ type: MSG.SCRYFALL_SEARCH, query: 'modi per dare haste', deckId: created.deck.id }, null);
    // Sintassi ibrida con vincolo esplicito: passa invariata.
    await handleMessage({ type: MSG.SCRYFALL_SEARCH, query: 't:goblin id:R', deckId: created.deck.id }, null);

    const urls = globalThis.__scryRequests.filter((u) => u.includes('/cards/search'));
    const qOf = (u) => new URL(u).searchParams.get('q');
    return { qAuto: qOf(urls[0]), qExplicit: qOf(urls[1]), cardName: r1.cards[0] && r1.cards[0].name };
  });

  expect(qAuto).toBe('modi per dare haste id<=UR');
  expect(qExplicit).toBe('t:goblin id:R');
  expect(cardName).toBe('Niv-Mizzet, Parun');
});

test('la cache carte evita richieste ripetute; la symbology si scarica una volta sola', async ({ app }) => {
  await mockScryfall(app);

  const { fetches, sym1, sym2, card } = await app.evaluate(async () => {
    const Scry = globalThis.SN_SCRYFALL;
    await Scry.card('niv-1');            // rete
    const card = await Scry.card('niv-1'); // cache: nessuna nuova richiesta
    const s1 = await Scry.symbols();     // rete
    const s2 = await Scry.symbols();     // cache permanente
    return {
      fetches: globalThis.__scryRequests,
      sym1: s1['{U}'], sym2: s2['{R}'],
      card,
    };
  });

  const cardFetches = fetches.filter((u) => u.includes('/cards/niv-1'));
  const symFetches = fetches.filter((u) => u.includes('/symbology'));
  expect(cardFetches).toHaveLength(1);
  expect(symFetches).toHaveLength(1);
  expect(sym1).toBe('https://svgs.test/U.svg');
  expect(sym2).toBe('https://svgs.test/R.svg');
  expect(card.priceEur).toBe(3.21);
});
