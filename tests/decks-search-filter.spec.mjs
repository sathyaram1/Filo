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
      if (u.pathname === '/cards/search') {
        // `__pages`: risultati su più pagine, come Scryfall oltre le 175 carte.
        const pages = globalThis.__pages || [globalThis.__searchCards || [CRASHER, BOLT]];
        const n = Number(u.searchParams.get('page') || '1');
        // `__failPages`: { pagina → quante volte ancora risponde 503 } (Infinity = finché la prova non cambia idea).
        const fails = globalThis.__failPages && globalThis.__failPages[n];
        if (fails > 0) {
          globalThis.__failPages[n] = fails - 1;
          return { ok: false, status: 503, json: async () => ({}) };
        }
        body = { data: pages[n - 1] || [], has_more: n < pages.length, total_cards: pages.reduce((t, p) => t + p.length, 0) };
      }
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
        // `__maxConcurrent`: un fornitore che oltre quel numero di richieste insieme risponde «troppe richieste».
        if (globalThis.__maxConcurrent && (globalThis.__inFlight || 0) >= globalThis.__maxConcurrent) {
          globalThis.__rejected = (globalThis.__rejected || 0) + 1;
          throw Object.assign(new Error('OpenRouter 429: Rate limit exceeded, retry shortly'), { status: 429 });
        }
        // Chiamata al giudice del filtro: registra e tieni solo Lightning Bolt (o fai quello che chiede la prova).
        globalThis.__filterCalls.push(last);
        globalThis.__inFlight = (globalThis.__inFlight || 0) + 1;
        globalThis.__maxInFlight = Math.max(globalThis.__maxInFlight || 0, globalThis.__inFlight);
        if (globalThis.__judgeGate) await globalThis.__judgeGate;
        await new Promise((r) => setTimeout(r, globalThis.__judgeMs || 5));
        globalThis.__inFlight -= 1;
        text = globalThis.__judge ? globalThis.__judge(last, attempts[0].model) : JSON.stringify({ keep: ['bolt-1'] });
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

// Carte finte per le prove su più pagine: tutte rosse, dentro l'identità del commander.
async function manyCards(app, { pages, relevant = [] }) {
  await app.evaluate((_electron, { pages, relevant }) => {
    const card = (id, name, cmc, oracle) => ({
      id, name, mana_cost: `{${cmc}}`, cmc, type_line: 'Artifact', oracle_text: oracle,
      colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/${id}.jpg` },
      prices: { eur: '0.10' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    let k = 0;
    globalThis.__pages = pages.map((size, p) => Array.from({ length: size }, () => {
      k += 1;
      const hit = relevant.includes(k);
      return card(`c-${k}`, hit ? `Giusta ${k}` : `Carta ${k}`, p + 1, hit ? 'Creatures you control have haste.' : 'Haste');
    }));
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste.', query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    // Tiene le «Giusta» di ogni lotto, coi numeri del SUO lotto.
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Giusta /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  }, { pages, relevant });
}

test('#382: la rete larga oltre la prima pagina arriva al giudice, e la carta giusta a pagina 2 si vede', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  // 175 carte a pagina 1, nessuna giusta; a pagina 2 la giusta.
  await manyCards(app, { pages: [175, 20], relevant: [180] });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Giusta 180');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble).not.toContainText('Scryfall ne ha trovate');
});

test('#382: oltre il tetto di pagine la chat dice quante erano, e il giudice lavora a gruppi', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175, 175, 175, 175, 175], relevant: [3, 1100] });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Giusta 3');
  await expect(bubble).toContainText('Scryfall ne ha trovate 1.225 e ho controllato le prime 1.050, in ordine di costo');
  const pagesAsked = await app.evaluate(() => globalThis.__scryRequests
    .filter((u) => u.includes('/cards/search')).map((u) => new URL(u).searchParams.get('page') || '1'));
  expect(pagesAsked).toEqual(['1', '2', '3', '4', '5', '6']);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(21);
  expect(await app.evaluate(() => globalThis.__maxInFlight)).toBeLessThanOrEqual(8);
});

test('#382: una pagina di Scryfall che non risponde una volta si riprova, e le carte giuste delle pagine dopo arrivano', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175], relevant: [7, 207, 407] });
  await app.evaluate(() => { globalThis.__failPages = { 2: 1 }; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  await expect(bubble.locator('.dk-cardlist')).toContainText('Giusta 407');
  await expect(bubble).not.toContainText('Scryfall ne ha trovate');
  await expect(bubble.locator('[data-retry]')).toHaveCount(0);
});

test('#382: se una pagina dopo la prima non risponde nemmeno riprovata, la chat lo dice e Riprova porta le altre carte', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175], relevant: [7, 207, 407] });
  await app.evaluate(() => { globalThis.__failPages = { 2: Infinity }; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble).toContainText('Scryfall ne ha trovate 525 ma ha smesso di rispondere dopo le prime 175');
  await expect(bubble).not.toContainText('vincolo');

  await app.evaluate(() => { globalThis.__failPages = {}; });
  await bubble.locator('[data-retry]').click();
  const again = page.locator('.dk-msg-bot').last();
  await expect(again.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 60_000 });
  await expect(again.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  await expect(again).not.toContainText('smesso di rispondere');
});

test('#382: una ricerca a parole che Scryfall non trova lo dice, anche dopo la frase del modello', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    globalThis.__pages = [[]];
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste.', query: 'o:"gives haste"', filter: 'fa guadagnare haste ad altre creature' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble).toContainText('Cerco carte che danno haste.');
  await expect(bubble).toContainText('Nessun risultato su Scryfall per questa ricerca, fra le carte nei colori del commander.');
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});

test('#382: una ricerca tutta in sintassi con più di una pagina lo dice, senza giudice', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 40] });
  await app.evaluate(() => { globalThis.__chat = () => JSON.stringify({ query: 'o:haste t:artifact' }); });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'o:haste t:artifact');
  await expect(bubble.locator('.dk-list-summary')).toContainText('175 risultati');
  await expect(bubble).toContainText('Scryfall ne ha trovate 215 e qui sotto ci sono le prime 175, in ordine di costo');
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});

test('#382: un giudice che risponde coi nomi non diventa «nessuna corrisponde», e la ricerca ripetuta torna a filtrare', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = () => JSON.stringify({ keep: ['Hammer of Purphoros'] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await expect(first).not.toContainText('nessuna corrisponde');
  await expect(first).toContainText('Non sono riuscito a controllare una per una le carte trovate');
  await expect(first.locator('.dk-cardlist .dk-row')).toHaveCount(2);

  await app.evaluate(() => {
    globalThis.__judge = (prompt) => JSON.stringify({ keep: [prompt.split('\n').find((l) => /Hammer of Purphoros/.test(l)).split('.')[0]] });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(again.locator('.dk-row-name').first()).toHaveText('Hammer of Purphoros');
});

test('#382: se un gruppo del giudice non risponde, le sue carte sono segnate nella lista, anche riaprendo la chat', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [120], relevant: [1, 51, 101] });
  await app.evaluate(() => {
    const judge = globalThis.__judge;
    // Il secondo gruppo (51-100) risponde sempre male.
    globalThis.__judge = (prompt) => (/Giusta 51 /.test(prompt) ? 'boh' : judge(prompt));
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble).toContainText('50 delle carte qui sotto, segnate con ?, non le ho potute controllare');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(52);
  await expect(bubble.locator('.dk-row-unchecked')).toHaveCount(50);
  await expect(bubble.locator('.dk-row', { hasText: 'Giusta 1' }).first()).not.toHaveClass(/dk-row-unchecked/);
  const flag = bubble.locator('.dk-row', { hasText: 'Carta 52' }).locator('.dk-row-flag');
  await expect(flag).toHaveText('?');
  await expect(flag).toHaveAttribute('title', /Non controllata/);
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382-non-controllate.png' });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const riaperta = page.locator('.dk-msg-bot').last();
  await expect(riaperta.locator('.dk-row-unchecked')).toHaveCount(50);
});

test('#382: mentre il giudice lavora la bolla dice cosa fa, con la frase di Filo e il conteggio', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [120], relevant: [7] });
  await app.evaluate(() => {
    globalThis.__judgeGate = new Promise((r) => { globalThis.__openGate = r; });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'carte che danno haste');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect.poll(() => app.evaluate(() => globalThis.__inFlight || 0), { timeout: 15_000 }).toBeGreaterThan(0);
  const status = bubble.locator('.dk-progress');
  await expect(status).toContainText('Controllo una per una le 120 carte trovate');
  await expect(status).toContainText('0 di 120');
  await expect(bubble).toContainText('Cerco carte che danno haste.');
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382-attesa.png' });
  await app.evaluate(() => globalThis.__openGate());
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-progress')).toHaveCount(0);
});

// Il giudice finto delle prove qui sotto è SEVERO come un modello onesto: tiene una carta solo se il suo prompt gli
// dà i dati per verificarla. `__head` è il prompt prima della lista, `__lines` le righe delle carte.
async function strictJudgeTools(app, cards) {
  await app.evaluate((_electron, cards) => {
    const card = (c) => ({
      id: c.id, name: c.name, mana_cost: `{${c.cmc}}`, cmc: c.cmc, type_line: c.type, oracle_text: c.oracle,
      power: c.power, toughness: c.toughness, colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${c.id}.jpg` }, prices: { eur: c.eur }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${c.id}`,
    });
    globalThis.__searchCards = cards.map(card);
    globalThis.__head = (prompt) => prompt.split('CARTE CANDIDATE:')[0];
    globalThis.__lines = (prompt) => (prompt.split('CARTE CANDIDATE:')[1] || '').split('\n').filter((l) => /^\d+\. /.test(l));
    globalThis.__nums = (lines) => lines.map((l) => Number(l.split('.')[0]));
  }, cards);
}

test('#382: una richiesta che parla del commander arriva al giudice col commander del mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await strictJudgeTools(app, [
    { id: 'opt-1', name: 'Opt', cmc: 1, type: 'Instant', oracle: 'Scry 1. Draw a card.', eur: '0.10' },
    { id: 'ogre-1', name: 'Hulking Ogre', cmc: 3, type: 'Creature — Ogre', oracle: 'Trample.', power: '3', toughness: '3', eur: '0.10' },
  ]);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(t:instant or t:creature)', filter: 'carte che sinergizzano con il commander del mazzo' });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: /Niv-Mizzet/.test(globalThis.__head(prompt))
        ? globalThis.__nums(globalThis.__lines(prompt).filter((l) => /Instant/.test(l))) : [],
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte in sinergia col mio commander');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble.locator('.dk-row-name')).toHaveText(['Opt']);
});

test('#382: il giudice vede prezzo, forza e costituzione, e non scarta per ciò che non vede', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await strictJudgeTools(app, [
    { id: 'shock-1', name: 'Shock', cmc: 1, type: 'Instant', oracle: 'Shock deals 2 damage to any target.', eur: '0.20' },
    { id: 'fury-1', name: 'Fury', cmc: 5, type: 'Creature — Elemental Incarnation', oracle: 'Double strike.', power: '3', toughness: '3', eur: '32.00' },
    { id: 'giant-1', name: 'Hill Giant', cmc: 4, type: 'Creature — Giant', oracle: '', power: '3', toughness: '3', eur: '0.05' },
    { id: 'ogre-1', name: 'Big Ogre', cmc: 5, type: 'Creature — Ogre', oracle: 'Trample.', power: '5', toughness: '4', eur: '0.05' },
  ]);
  await app.evaluate(() => {
    globalThis.__chat = (last) => (/euro/.test(last)
      ? JSON.stringify({ query: '(o:damage) eur<1', filter: 'infligge danni e costa meno di 1 euro' })
      : JSON.stringify({ query: 't:creature pow>=5', filter: 'creatura con forza 5 o più, di rarità comune' }));
    globalThis.__judge = (prompt) => {
      const ls = globalThis.__lines(prompt);
      if (/euro/.test(globalThis.__head(prompt))) {
        if (!ls.every((l) => /€/.test(l))) return JSON.stringify({ keep: [] });
        return JSON.stringify({ keep: globalThis.__nums(ls.filter((l) => /damage/.test(l) && /prezzo 0,/.test(l))) });
      }
      // La rarità la riga non la mostra: un giudice che obbedisce alle regole non scarta per quella.
      if (!/non scartare una carta per quello/.test(prompt)) return JSON.stringify({ keep: [] });
      return JSON.stringify({ keep: globalThis.__nums(ls.filter((l) => /forza\/costituzione 5\//.test(l))) });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const cheap = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(cheap.locator('.dk-row-name')).toHaveText(['Shock']);
  const big = await send(page, 'creature comuni con forza 5 o più');
  await expect(big.locator('.dk-row-name')).toHaveText(['Big Ogre']);
});

test('#382: un seguito senza "filter" dal modello porta al giudice la richiesta di prima', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    let n = 0;
    globalThis.__chat = () => (++n === 1
      ? JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' })
      : JSON.stringify({ query: '(o:"have haste" or o:haste) cmc<=3' }));
    // Tiene chi DÀ haste se il prompt porta la richiesta di haste (le regole fisse la nominano già, la frase no);
    // altrimenti giudica solo il costo, e passano tutte.
    globalThis.__judge = (prompt) => {
      const head = prompt.split('CARTE CANDIDATE:')[0];
      const lines = prompt.split('CARTE CANDIDATE:')[1].split('\n').filter((l) => /^\d+\. /.test(l));
      const keep = /danno haste|haste ad altre/i.test(head) ? lines.filter((l) => /have haste/.test(l)) : lines;
      return JSON.stringify({ keep: keep.map((l) => Number(l.split('.')[0])) });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await expect(first.locator('.dk-row-name')).toHaveText(['Hammer of Purphoros']);
  const next = await send(page, 'e solo quelle che costano poco');
  await expect(next.locator('.dk-row-name')).toHaveText(['Hammer of Purphoros']);
  // La nota parla con le parole dell'utente, non col contesto dato al giudice.
  await expect(next).not.toContainText('Richieste precedenti');
});

test('#382: scelto un altro modello per il filtro, la stessa ricerca la giudica il modello nuovo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await hasteCards(app);
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: '(o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    // Il giudice di partenza sbaglia e tiene Goblin Guide; quello scelto dopo tiene l'equipaggiamento giusto.
    globalThis.__judge = (prompt, model) => {
      const pick = /gemma/.test(model) ? /Hammer of Purphoros/ : /Goblin Guide/;
      return JSON.stringify({ keep: [prompt.split('\n').find((l) => /^\d+\. /.test(l) && pick.test(l)).split('.')[0]] });
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await expect(first.locator('.dk-row-name')).toHaveText(['Goblin Guide']);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ models: { ...s.models, [C.ACTIONS.DECKS_SEARCH_FILTER]: 'gemma' } });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-row-name')).toHaveText(['Hammer of Purphoros']);
});

test('#382: una sessione di ricerche larghe non svuota la cronologia AI né le risposte già pronte del resto di Filo', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 175, 175, 175, 175, 175, 175], relevant: [3] });
  await app.evaluate(async () => {
    // Testo Oracle di lunghezza realistica: il prompt del giudice pesa quanto quello vero.
    const long = ' Whenever another creature you control enters, you may pay {1}. If you do, put a +1/+1 counter on it and it gains trample until end of turn.';
    for (const p of globalThis.__pages) for (const c of p) c.oracle_text += long;
    let n = 0;
    // Criteri diversi a ogni turno, come le frasi di una sessione vera: niente giudizi già in cache.
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: `fa guadagnare haste ad altre creature (${++n})` });
    await globalThis.SN_HISTORY.append({
      action: globalThis.SN_CONST.ACTIONS.FILO_CHAT, provider: 'openrouter', model: 'x',
      input: { text: 'domanda di stamattina' }, output: 'risposta di stamattina', origin: 'filo://home',
    });
    // Una risposta già pronta di un'altra funzione: rifatta la stessa domanda, Filo risponde senza pagare.
    await globalThis.SN_AI_CACHE.set({ provider: 'openrouter', model: 'x', messages: [{ role: 'user', content: 'spiega «haste»' }], text: 'pronta' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  for (let i = 0; i < 14; i++) {
    const bubble = await send(page, `carte che danno haste ${i + 1}`);
    await expect(bubble.locator('.dk-row-name')).toHaveText(['Giusta 3']);
  }
  const kept = await app.evaluate(async () => (await globalThis.SN_HISTORY.list())
    .some((it) => it.input && it.input.text === 'domanda di stamattina'));
  expect(kept, 'la voce di stamattina è uscita per far posto ai controlli delle ricerche').toBe(true);
  const ready = await app.evaluate(async () => globalThis.SN_AI_CACHE.get({
    provider: 'openrouter', model: 'x', messages: [{ role: 'user', content: 'spiega «haste»' }],
  }));
  expect(ready && ready.text, 'la risposta già pronta è uscita per far posto a quelle del giudice').toBe('pronta');
});

test('#382: un fornitore che risponde «troppe richieste» ai controlli in parallelo non lascia carte non controllate', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  // Tre pagine, 525 carte, 11 gruppi al giudice con una carta giusta ciascuno; il fornitore ne regge quattro insieme.
  await manyCards(app, { pages: [175, 175, 175], relevant: Array.from({ length: 11 }, (_, i) => i * 50 + 7) });
  await app.evaluate(() => { globalThis.__maxConcurrent = 4; globalThis.__judgeMs = 300; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'carte che danno haste');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 60_000 });
  expect(await app.evaluate(() => globalThis.__rejected || 0)).toBeGreaterThan(0);
  await expect(bubble).not.toContainText('non le ho potute controllare');
  await expect(bubble.locator('.dk-row-unchecked')).toHaveCount(0);
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(11);
});

test('#382: un giudizio che dipendeva dal prezzo si rifà quando il prezzo cambia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = (id, name, eur) => ({
      id, name, mana_cost: '{R}', cmc: 1, type_line: 'Instant', oracle_text: `${name} deals 3 damage to any target.`,
      colors: ['R'], color_identity: ['R'], image_uris: { normal: `https://cards.test/${id}.jpg` },
      prices: { eur }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    globalThis.__card = card;
    globalThis.__searchCards = [card('shock-1', 'Shock', '0.50'), card('bolt-1', 'Lightning Bolt', '2.00')];
    // Il prezzo sta nel criterio e non nella query, come chiedono le regole della chat.
    globalThis.__chat = () => JSON.stringify({ query: '(o:damage or o:deals)', filter: 'infligge danni ed è sotto 1 euro' });
    // Giudice onesto: tiene le carte che, nella riga che vede, costano meno di 1 €.
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. /.test(l)).filter((l) => {
        const m = l.match(/prezzo (\d+),(\d+) €/);
        return m && Number(`${m[1]}.${m[2]}`) < 1;
      }).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(first.locator('.dk-row-name')).toHaveText(['Shock']);
  // Ripetuta coi prezzi uguali, la stessa ricerca riusa i giudizi.
  const again = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(again.locator('.dk-row-name')).toHaveText(['Shock']);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(1);

  // Tempo dopo: Shock è salito a 3 €, Lightning Bolt è sceso a 0,40 €.
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__searchCards = [card('shock-1', 'Shock', '3.00'), card('bolt-1', 'Lightning Bolt', '0.40')];
  });
  const later = await send(page, 'rimozioni a danno sotto 1 euro');
  await expect(later.locator('.dk-row-name')).toHaveText(['Lightning Bolt']);
});

test('#382: se il controllo non riesce la bolla ha il tasto Riprova, anche riaprendo la chat, e rifà la ricerca filtrata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [60], relevant: [7] });
  await app.evaluate(() => {
    globalThis.__good = globalThis.__judge;
    globalThis.__judge = () => 'non saprei';
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await expect(bubble).toContainText('Riprova');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(60);
  await expect(bubble.locator('[data-retry]')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/decks-search-filter-382-riprova.png' });

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const riaperta = page.locator('.dk-msg-bot').last();
  await expect(riaperta.locator('[data-retry]')).toBeVisible();

  await app.evaluate(() => { globalThis.__judge = globalThis.__good; });
  await riaperta.locator('[data-retry]').click();
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  const rifatta = page.locator('.dk-msg-bot').last();
  await expect(rifatta.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 15_000 });
  await expect(rifatta.locator('.dk-row-name')).toHaveText(['Giusta 7']);
  await expect(rifatta.locator('[data-retry]')).toHaveCount(0);
});

test('#382: un messaggio tutto in sintassi non passa dal giudice nemmeno se il modello scrive un criterio', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [3], relevant: [2] });
  await app.evaluate(() => {
    // Il modello riassume la sintassi a parole, e la riassume male: «dà haste» invece di «ha haste nel testo».
    globalThis.__chat = () => JSON.stringify({ query: 'o:haste', filter: 'fa guadagnare haste ad altre creature' });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'o:haste');
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});
