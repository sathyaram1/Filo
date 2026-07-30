// Client Scryfall del deck builder (task 2): impostare il commander risolve la
// carta via Scryfall (qui mockato: niente rete) e la libreria mostra art crop
// e pip dei colori REALI. La ricerca vincola automaticamente la query alla
// color identity del commander (§4). Il fetch è sostituito nel main con
// SN_SCRYFALL._setFetch; i messaggi partono dalla pagina con
// chrome.runtime.sendMessage — lo stesso cammino IPC dell'app vera.

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
    globalThis.__scryHeaders = [];
    globalThis.SN_SCRYFALL._setFetch(async (url, opts) => {
      globalThis.__scryRequests.push(String(url));
      globalThis.__scryHeaders.push((opts && opts.headers) || {});
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

// Crea un mazzo dalla UI e gli imposta il commander mockato via IPC (la UI di
// scelta commander arriva coi task 4/5). Ritorna l'id del mazzo, col builder aperto.
async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  }, deckId);
  expect(r && r.ok, 'set commander deve riuscire: ' + JSON.stringify(r)).toBe(true);
  return deckId;
}

test('impostare il commander porta art crop e pip reali nella libreria', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await deckWithCommander(page);

  // Torna alla libreria: la card del mazzo mostra i pip U e R (ordine WUBRG)
  // e l'art crop del commander.
  await page.click('#backToLibrary');
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

  // Feedback #345: un mazzo senza nome scelto prende automaticamente il nome del
  // commander (nell'header e nella card di libreria).
  await expect(page.locator('#deckNameText')).toHaveText('Niv-Mizzet, Parun');
  await expect(card.locator('.sn-card-title')).toHaveText('Niv-Mizzet, Parun');
});

test('si può rimuovere il commander e la sua carta torna nel mazzo (feedback #302)', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Precondizione: il commander è impostato (senza il fix non c'è modo di tornare indietro).
  await expect(page.locator('#commanderLine')).toHaveText(/Niv-Mizzet, Parun/);

  // Dal menu del mazzo (click sul nome) scegli "Rimuovi commander".
  await page.click('#deckName');
  await page.locator('#deckHead .sn-select-option', { hasText: 'Rimuovi commander' }).click();

  // Successo: il mazzo torna a "nessun commander"…
  await expect(page.locator('#commanderLine')).toHaveText(/Nessun commander/);
  // …e la carta che era commander NON è persa: è di nuovo una carta del mazzo.
  await expect(page.locator('#deckList .dk-row[data-card-id="niv-1"]')).toHaveCount(1);

  // Impostato di nuovo un commander, il menu offre ancora la rimozione (idempotente).
  const r = await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const id = decodeURIComponent(location.hash.replace('#/deck/', ''));
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  });
  expect(r && r.ok).toBe(true);
});

test('l\'auto-nome dal commander NON sovrascrive un nome scelto dall\'utente', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/deck/', '')));

  // L'utente rinomina il mazzo a mano (stesso cammino della voce "Rinomina…").
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const g = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const renamed = window.SN_DECKS.renameDeck(g.deck, 'Il mio mazzone');
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck: renamed });
  }, deckId);

  // Poi imposta un commander: il nome scelto deve restare intatto.
  const r = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  }, deckId);
  expect(r && r.ok).toBe(true);
  expect(r.deck.nome).toBe('Il mio mazzone');
  expect(r.deck.commanderMeta && r.deck.commanderMeta.name).toBe('Niv-Mizzet, Parun');
});

test('la ricerca è vincolata all\'identity del commander; sintassi esplicita passa invariata', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await deckWithCommander(page);

  const { cardName } = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    // Ricerca nel contesto del mazzo: id<=UR aggiunto da solo.
    const r1 = await chrome.runtime.sendMessage({ type: MSG.SCRYFALL_SEARCH, query: 'modi per dare haste', deckId: id });
    // Sintassi ibrida con vincolo esplicito: passa invariata.
    await chrome.runtime.sendMessage({ type: MSG.SCRYFALL_SEARCH, query: 't:goblin id:R', deckId: id });
    return { cardName: r1.cards && r1.cards[0] && r1.cards[0].name };
  }, deckId);

  const [qAuto, qExplicit] = await app.evaluate(() =>
    globalThis.__scryRequests
      .filter((u) => u.includes('/cards/search'))
      .map((u) => new URL(u).searchParams.get('q')));

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

test('ogni richiesta Scryfall porta uno User-Agent identificativo (Filo/<versione>)', async ({ app }) => {
  await mockScryfall(app);

  const headers = await app.evaluate(async () => {
    const Scry = globalThis.SN_SCRYFALL;
    await Scry.card('niv-1');
    await Scry.search('t:dragon');
    return globalThis.__scryHeaders;
  });

  // Scryfall risponde 400 `generic_user_agent` alle richieste con la UA di
  // default della libreria HTTP: senza header identificativo l'app è cieca
  // sul database carte (ricerca in chat, hover, commander…).
  expect(headers.length).toBeGreaterThan(0);
  for (const h of headers) {
    expect(h['User-Agent']).toMatch(/^Filo\/\d+\.\d+\.\d+ \(.+\)$/);
  }
});
