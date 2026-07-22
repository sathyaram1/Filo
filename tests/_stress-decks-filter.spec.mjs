// STRESS verifier (temporaneo, non versionato): stessi mock del filtro semantico,
// ma si stressano i cammini limite che l'happy-path non copre:
//  A) il filtro SCARTA TUTTO → l'utente NON resta a mani vuote (fallback ai risultati larghi).
//  B) il giudice risponde SPAZZATURA (JSON non valido) → fallback ai risultati larghi.
//  C) ricerca MECCANICA (no "filter") → il giudice NON viene chiamato.
//  D) nome carta con <script> → reso ESCAPED, niente esecuzione.

import { test, expect } from './fixtures/electron.mjs';

function mkCards() {
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
  // Nome con payload XSS: se non escapato eseguirebbe/romperebbe il markup.
  const XSS = {
    id: 'xss-1', name: '<img src=x onerror=window.__pwned=1>Zap', mana_cost: '{R}', cmc: 1, type_line: 'Instant',
    oracle_text: 'Zap deals 1 damage.',
    colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/zap.jpg' },
    prices: { eur: '0.10' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/zap',
  };
  return { COMMANDER, BOLT, XSS };
}

// mode: 'empty' → keep:[]; 'garbage' → testo non-JSON; 'ok' → keep bolt-1
async function mockScryfallAndProvider(app, mode) {
  await app.evaluate(({ mode, cards }) => {
    const { COMMANDER, BOLT, XSS } = cards;
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'xss-1': XSS };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [BOLT, XSS], has_more: false };
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [
        { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
        { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
      ] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });

    const C = globalThis.SN_CONST;
    globalThis.__filterCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        globalThis.__filterCalls.push(last);
        if (mode === 'empty') text = JSON.stringify({ keep: [] });
        else if (mode === 'garbage') text = 'non sono un json, mi dispiace!!! <script>';
        else text = JSON.stringify({ keep: ['bolt-1'] });
      } else if (/mecc-esatta/i.test(last)) {
        // Ricerca meccanica: NIENTE "filter".
        text = JSON.stringify({ reply: 'Ecco.', query: 't:instant cmc<=1' });
      } else if (/danni/i.test(last)) {
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

    return globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'flash-lite-3',
        [C.ACTIONS.DECKS_SEARCH_FILTER]: 'flash-lite-3',
      },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
  }, { mode, cards: mkCards() });
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
  expect(r && r.ok).toBe(true);
  return deckId;
}

test('A) filtro svuota tutto → fallback ai risultati larghi (niente schermo vuoto)', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfallAndProvider(app, 'empty');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'carte che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  // Il giudice ha scartato TUTTO: si mostrano comunque le 2 carte larghe.
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(1);
});

test('B) giudice risponde spazzatura → fallback ai risultati larghi', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfallAndProvider(app, 'garbage');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'carte che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

test('C) ricerca meccanica (no filter) → il giudice NON viene chiamato', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfallAndProvider(app, 'ok');
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'istantanei mecc-esatta a 1 mana');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  // Nessuna chiamata al giudice del filtro per ricerca meccanica.
  expect(await app.evaluate(() => globalThis.__filterCalls.length)).toBe(0);
});

test('D) nome carta con <script>/<img> è reso escaped, niente esecuzione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfallAndProvider(app, 'ok'); // keep bolt-1 → resta solo Bolt, ma testo XSS mai eseguito
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'carte che fanno danni');
  await page.press('#chatInput', 'Enter');
  await page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row').first().waitFor();
  // La pagina non è stata compromessa dal nome malevolo passato tra i candidati.
  expect(await page.evaluate(() => window.__pwned || false)).toBe(false);
});
