// #382 giro 3: prove avversariali sul giudice delle ricerche a parole del deck builder.
// Scryfall e provider finti nel main, come in tests/decks-search-filter.spec.mjs.

import { test, expect } from '../../fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard', oracle_text: 'Whenever you draw a card, Niv-Mizzet deals 1 damage to any target.',
      colors: ['U', 'R'], color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/niv',
    };
    const BY_ID = { 'niv-1': COMMANDER };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        const pages = globalThis.__pages || [globalThis.__searchCards || []];
        const n = Number(u.searchParams.get('page') || '1');
        body = { data: pages[n - 1] || [], has_more: n < pages.length, total_cards: pages.reduce((t, p) => t + p.length, 0) };
      } else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.DECKS_SEARCH_FILTER]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__filterCalls = [];
    globalThis.__rejected = 0;
    globalThis.__inFlight = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        // Un fornitore che regge al più `__maxConcurrent` richieste insieme: oltre risponde «troppe richieste».
        if (globalThis.__maxConcurrent && globalThis.__inFlight >= globalThis.__maxConcurrent) {
          globalThis.__rejected += 1;
          throw Object.assign(new Error('OpenRouter 429: Rate limit exceeded, retry shortly'), { status: 429 });
        }
        globalThis.__filterCalls.push(last);
        globalThis.__inFlight += 1;
        try {
          if (globalThis.__judgeGate) await globalThis.__judgeGate;
          await new Promise((r) => setTimeout(r, globalThis.__judgeMs || 5));
        } finally { globalThis.__inFlight -= 1; }
        text = globalThis.__judge(last, attempts[0].model);
      } else {
        text = globalThis.__chat(last);
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
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Giusta /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  }, { pages, relevant });
}

async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  expect(r && r.ok).toBe(true);
  return deckId;
}

async function send(page, text) {
  const bots = page.locator('.dk-msg-bot');
  const before = await bots.count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(bots).toHaveCount(before + 1);
  const bubble = bots.nth(before);
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 30_000 });
  return bubble;
}

test('un fornitore che risponde «troppe richieste» ai controlli in parallelo non lascia carte non controllate', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  // Tre pagine di Scryfall, 525 carte, 11 gruppi al giudice; la carta giusta è in ogni gruppo.
  const relevant = Array.from({ length: 11 }, (_, i) => i * 50 + 7);
  await manyCards(app, { pages: [175, 175, 175], relevant });
  await app.evaluate(() => { globalThis.__maxConcurrent = 4; globalThis.__judgeMs = 300; });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  const rejected = await app.evaluate(() => globalThis.__rejected);
  console.log('rifiuti 429:', rejected, 'chiamate servite:', await app.evaluate(() => globalThis.__filterCalls.length));
  await page.screenshot({ path: 'tests/.shots/verifica-382-giro3-429.png' });
  // SUCCESSO per l'utente: tutte le carte controllate, solo le 11 giuste in lista, nessuna segnata «non controllata».
  await expect(bubble).not.toContainText('non le ho potute controllare');
  await expect(bubble.locator('.dk-row-unchecked')).toHaveCount(0);
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(11);
});

test('esplora: bolla in attesa e righe non controllate, tema chiaro e scuro', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [175, 60], relevant: [7, 180] });
  await app.evaluate(() => { globalThis.__judgeGate = new Promise((r) => { globalThis.__openGate = r; }); });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await page.fill('#chatInput', 'carte che danno haste');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-progress')).toContainText('Controllo una per una le 235 carte trovate');
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `tests/.shots/verifica-382-giro3-attesa-${tema}.png` });
  }
  // Il secondo gruppo risponde in un formato illeggibile: le sue carte restano segnate.
  await app.evaluate(() => {
    const good = globalThis.__judge;
    globalThis.__judge = (prompt) => (/Giusta 180/.test(prompt) || /Carta 200 /.test(prompt) ? 'boh' : good(prompt));
    globalThis.__openGate();
  });
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 30_000 });
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `tests/.shots/verifica-382-giro3-dopo-${tema}.png` });
  }
  console.log('testo bolla:', await bubble.innerText());
});

test('esplora: markup nella richiesta finisce come testo nella risposta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await manyCards(app, { pages: [3] });
  await app.evaluate(() => {
    globalThis.__chat = () => JSON.stringify({ query: 'o:haste' });
    globalThis.__judge = () => JSON.stringify({ keep: [] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  const bubble = await send(page, '<img src=x id=inj onerror="window.__pwn=1"> carte che danno haste');
  await expect(bubble).toContainText('<img src=x');
  await expect(page.locator('#inj')).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwn || 0)).toBe(0);
});
