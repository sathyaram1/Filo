// Build-around in chat (feedback #337): quando l'utente vuole costruire un mazzo
// attorno a un commander preciso (o dice qual è il commander di questo mazzo),
// Filo deve (1) IMPOSTARE quel commander da solo su un mazzo che non ne ha uno e
// (2) filtrare la ricerca fatta nello STESSO turno sui colori di quel commander
// — non proporre carte fuori colore. Sia il provider LLM sia Scryfall sono
// mockati nel main (nessuna rete), ma i messaggi viaggiano sul cammino IPC reale
// della pagina. Si asserisce il SUCCESSO: il commander finisce nell'header, la
// richiesta Scryfall porta id<= e le carte fuori identità spariscono dai
// risultati. Senza il fix: identity nulla → niente id<=, la carta verde resta e
// il commander non viene mai impostato → gli assert diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

// Scryfall finto: un commander Izzet (U/R), una carta rossa (dentro identità) e
// una verde (fuori). La ricerca torna ENTRAMBE apposta: il filtro duro di
// identità nel main deve togliere la verde. `/cards/named` risolve il commander.
async function mockScryfall(app) {
  await app.evaluate(() => {
    const NIV = {
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
    const BOLT = { // dentro l'identità U/R
      id: 'bolt-1',
      name: 'Lightning Bolt',
      mana_cost: '{R}',
      cmc: 1,
      type_line: 'Instant',
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/bolt.jpg' },
      prices: { eur: '1.10' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/bolt',
    };
    const ELF = { // FUORI identità (verde): va scartata dopo l'imposta-commander
      id: 'elf-1',
      name: 'Llanowar Elves',
      mana_cost: '{G}',
      cmc: 1,
      type_line: 'Creature — Elf Druid',
      colors: ['G'],
      color_identity: ['G'],
      image_uris: { normal: 'https://cards.test/elf.jpg' },
      prices: { eur: '0.20' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/elf',
    };
    const BY_ID = { 'niv-1': NIV, 'bolt-1': BOLT, 'elf-1': ELF };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [ELF, BOLT], has_more: false };
      else if (u.pathname === '/cards/named') body = NIV; // risolve il commander per nome
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{G}', svg_uri: 'https://svgs.test/G.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Provider LLM finto: al messaggio di build-around risponde con "commander" (il
// nome del commander) + una "query" nello stesso turno; per il resto tace.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      const text = /costru|mazzo con|niv/i.test(last)
        ? JSON.stringify({ reply: 'Ottima scelta, partiamo da qui.', commander: 'Niv-Mizzet, Parun', query: 'o:draw' })
        : JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

test('build-around: imposta il commander da solo e filtra la ricerca sui suoi colori', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // Mazzo NUOVO, senza commander (il caso del feedback).
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('#commanderLine')).toContainText('Nessun commander');
  const deckId = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/deck/', '')));

  // "Costruiamo un mazzo con Niv-Mizzet" → build-around.
  await page.fill('#chatInput', 'costruiamo un mazzo con Niv-Mizzet, Parun');
  await page.press('#chatInput', 'Enter');

  // (1) Il commander è stato impostato DA SOLO: header aggiornato + persistito.
  await expect(page.locator('#commanderLine')).toContainText('Niv-Mizzet, Parun');
  const persisted = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    return r && r.ok ? r.deck.commander : null;
  }, deckId);
  expect(persisted).toBe('niv-1');

  // (2) La ricerca dello stesso turno è filtrata sui colori del commander:
  //     la richiesta Scryfall porta id<=UR anche se il modello non l'ha scritto.
  const searchReq = await app.evaluate(() =>
    (globalThis.__scryRequests || []).find((u) => u.includes('/cards/search')));
  expect(searchReq, 'la ricerca Scryfall deve partire').toBeTruthy();
  expect(decodeURIComponent(searchReq)).toContain('id<=UR');

  // (3) La carta verde (fuori identità) NON compare tra i risultati; la rossa sì.
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name')).toHaveText('Lightning Bolt');
  await expect(page.locator('#deckList .dk-row[data-card-id="elf-1"]')).toHaveCount(0);
});

test('mazzo con commander già impostato: un nome in chat non lo sovrascrive', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = await page.evaluate(() => decodeURIComponent(location.hash.replace('#/deck/', '')));
  // Commander già presente (rosso mono: identità R) — persistito nello store,
  // che è la verità che rilegge l'handler della chat a ogni turno.
  const r0 = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'bolt-1' });
  }, deckId);
  expect(r0 && r0.ok && r0.deck.commander).toBe('bolt-1');

  // Anche se il modello torna "commander", il mazzo NE HA GIÀ uno → non cambia.
  await page.fill('#chatInput', 'costruiamo un mazzo con Niv-Mizzet, Parun');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toBeVisible();
  const still = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    return r && r.ok ? r.deck.commander : null;
  }, deckId);
  expect(still).toBe('bolt-1');
});
