// Filtro semantico dei risultati di ricerca (§4.1): la chat produce una query
// Scryfall LARGA (sinonimi) per non perdere carte; poi un LLM economico
// (configurabile come gli altri) giudica carta-per-carta se rispetta l'intento
// dell'utente, in batch, con cache (carta, criterio). Provider LLM e Scryfall
// MOCKATI nel main (niente rete), messaggi sul cammino IPC reale.
//
// Si asserisce il SUCCESSO: una ricerca "a parole" con criterio restringe i
// risultati larghi alle sole carte pertinenti (2 candidate → 1 tenuta), e una
// seconda ricerca IDENTICA riusa la cache (nessuna nuova chiamata al giudice).

import { test, expect } from './fixtures/electron.mjs';

// Due carte candidate: BOLT rispetta il criterio, CRASHER no. Entrambe R
// (dentro la color identity UR del commander).
async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/niv',
    };
    const BOLT = {
      id: 'bolt-1', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/bolt.jpg' },
      prices: { eur: '1.10' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/bolt',
    };
    const CRASHER = {
      id: 'crasher-1', name: 'Embercleave Crasher', mana_cost: '{2}{R}{R}', cmc: 4, type_line: 'Creature — Ogre',
      oracle_text: 'Trample.',
      colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/crasher.jpg' },
      prices: { eur: '0.30' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/crasher',
    };
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: globalThis.__searchCards || [CRASHER, BOLT], has_more: false };
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{2}', svg_uri: 'https://svgs.test/2.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Provider LLM finto. Distingue due tipi di chiamata dal contenuto:
//  - CHAT (traduzione NL→query): la richiesta "danni" → query LARGA + filter;
//  - FILTRO (§4.1): il prompt cita "CARTE CANDIDATE" → tiene SOLO bolt-1.
// Conta separatamente le chiamate al giudice del filtro per asserire la cache.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash',
        [C.ACTIONS.DECKS_SEARCH_FILTER]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__filterCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        // Chiamata al giudice del filtro: registra e tieni solo Lightning Bolt (o fai quello che chiede la prova).
        globalThis.__filterCalls.push(last);
        text = globalThis.__judge ? globalThis.__judge(last) : JSON.stringify({ keep: ['bolt-1'] });
      } else if (globalThis.__chat) {
        text = globalThis.__chat(last);
      } else if (/danni/i.test(last)) {
        // Ricerca "a parole": query VOLUTAMENTE LARGA + criterio da filtrare.
        text = JSON.stringify({
          reply: 'Cerco carte che fanno danni.',
          query: '(o:damage or o:deals or o:burn)',
          filter: 'infligge danni diretti a una creatura o al giocatore',
        });
      } else {
        text = JSON.stringify({ reply: 'Ok.' });
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

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

test('ricerca larga + filtro semantico: 2 candidate → 1 tenuta; la ripetizione riusa la cache', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Ricerca "a parole": il modello dà una query larga (sinonimi in OR) + un
  // criterio. Scryfall ritorna 2 carte; il giudice ne tiene UNA.
  await page.fill('#chatInput', 'carte che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  // SUCCESSO: la CardList mostra SOLO la carta pertinente (non entrambe).
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Lightning Bolt');
  // La carta scartata dal filtro NON compare.
  await expect(bubble.locator('.dk-cardlist')).not.toContainText('Embercleave Crasher');

  // La query mandata a Scryfall è quella LARGA (con gli OR di sinonimi) + il
  // vincolo id<= automatico: la rete ampia è partita davvero.
  const searchReq = await app.evaluate(() =>
    (globalThis.__scryRequests || []).find((u) => u.includes('/cards/search')));
  expect(decodeURIComponent(searchReq)).toContain('or o:');
  expect(decodeURIComponent(searchReq)).toContain('id<=UR');

  // Il giudice del filtro è stato invocato UNA volta.
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(1);

  // Traccia visiva ispezionabile (gitignorata).
  await page.screenshot({ path: 'tests/.shots/decks-search-filter.png' });

  // Seconda ricerca IDENTICA: stesso criterio → i giudizi sulle stesse carte
  // vengono dalla cache, NESSUNA nuova chiamata al giudice, stesso risultato.
  await page.fill('#chatInput', 'carte che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble2 = page.locator('.dk-msg-bot').last();
  await expect(bubble2.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble2.locator('.dk-row-name').first()).toHaveText('Lightning Bolt');
  // Il contatore del giudice NON è avanzato: la cache ha coperto tutto.
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(1);
});

// #382 — la ricerca a parole passa SEMPRE dal giudice, e ciò che il giudice scarta non si vede mai.
// Le carte della segnalazione: una creatura che HA haste (da scartare) e un equipaggiamento che la DÀ.
async function hasteCards(app) {
  await app.evaluate(() => {
    const card = (id, name, cmc, type, oracle) => ({
      id, name, mana_cost: `{${cmc}}`, cmc, type_line: type, oracle_text: oracle,
      colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/${id}.jpg` },
      prices: { eur: '0.50' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    globalThis.__searchCards = [
      card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste'),
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
    ];
  });
}

// La bolla di QUESTO turno, a risposta arrivata.
async function send(page, text) {
  const bots = page.locator('.dk-msg-bot');
  const before = await bots.count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(bots).toHaveCount(before + 1);
  const bubble = bots.nth(before);
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 15_000 });
  return bubble;
}

test('#382: senza "filter" dal modello la ricerca a parole passa comunque dal giudice, con la richiesta come criterio', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    // Il modello scrive la query larga coi sinonimi ma dimentica "filter": è la porta da cui passavano le carte sbagliate.
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste.', query: '(o:"gains haste" or o:"have haste" or o:haste)' });
    globalThis.__judge = (prompt) => JSON.stringify({ keep: [prompt.split('\n').find((l) => /Hammer of Purphoros/.test(l)).split('.')[0]] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Hammer of Purphoros');
  await expect(bubble.locator('.dk-cardlist')).not.toContainText('Goblin Guide');
  const calls = await app.evaluate(() => globalThis.__filterCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain('"carte che danno haste"');
  // I candidati arrivano numerati: il giudice risponde coi numeri, non ricopiando gli id.
  expect(calls[0]).toMatch(/^1\. Goblin Guide/m);
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382.png' });
});

test('#382: un messaggio tutto in sintassi Scryfall non passa dal giudice', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: 'o:haste t:creature' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'o:haste t:creature');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});

test('#382: se il giudice le scarta tutte non si mostrano, e la risposta lo dice', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(o:haste or o:rush)', filter: 'dà haste alle creature attaccanti al turno 1' });
    globalThis.__judge = () => JSON.stringify({ keep: [] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'haste al primo turno');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(0);
  await expect(bubble).toContainText('Ho controllato una per una le 2 carte trovate, ma nessuna corrisponde a «dà haste alle creature attaccanti al turno 1»');
  await expect(bubble).not.toContainText('Goblin Guide');
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382-nessuna.png' });
});

test('#382: un giudice che risponde male si richiede, poi le carte restano ma la risposta avvisa; e il guasto non finisce in cache', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = () => 'Non saprei.';
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await expect(bubble).toContainText('Non sono riuscito a controllare una per una le carte trovate');
  await expect(bubble).toContainText('formato che non so leggere');
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382-guasto.png' });
  // Una richiesta ripetuta senza cache, non di più.
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(2);

  // Il giudice torna a funzionare: la stessa ricerca lo richiama (niente «tutte scartate» salvato) e filtra davvero.
  await app.evaluate(() => {
    globalThis.__judge = (prompt) => JSON.stringify({ keep: [prompt.split('\n').find((l) => /Hammer of Purphoros/.test(l)).split('.')[0]] });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(again.locator('.dk-row-name').first()).toHaveText('Hammer of Purphoros');
  await expect(again).not.toContainText('Non sono riuscito');
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(3);
});

test('#382: oltre un lotto il giudice le guarda tutte, in più chiamate, senza lasciarne fuori nessuna', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const cards = [];
    for (let i = 1; i <= 130; i++) {
      cards.push({
        id: `c-${i}`, name: `Carta ${String(i).padStart(3, '0')}${i % 2 ? '' : ' Pari'}`, mana_cost: '{R}', cmc: 1, type_line: 'Instant',
        oracle_text: 'Draw a card.', colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/c${i}.jpg` },
        prices: { eur: '0.10' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/c${i}`,
      });
    }
    globalThis.__searchCards = cards;
    globalThis.__chat = () => JSON.stringify({ query: 'o:draw', filter: 'carte pari' });
    // Tiene le «Pari» di ogni lotto, coi numeri del SUO lotto.
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. .* Pari ·/.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'pescate pari');
  await expect(bubble.locator('.dk-list-summary')).toContainText('65 risultati');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Carta 130 Pari');
  await expect(bubble.locator('.dk-cardlist')).not.toContainText('Carta 129');
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(3);
});
