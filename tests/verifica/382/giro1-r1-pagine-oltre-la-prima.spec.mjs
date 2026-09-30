// #382 verifica giro 1: una ricerca a parole larga apposta supera la prima pagina di Scryfall (175 carte);
// le carte giuste delle pagine dopo devono arrivare al giudice e comparire, e la chat non deve dire di averle viste tutte.
import { test, expect } from '../../fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cmc, type, oracle, ci = ['R']) => ({
      id, name, mana_cost: `{${cmc}}`, cmc, type_line: type, oracle_text: oracle,
      colors: ci, color_identity: ci, image_uris: { normal: `https://cards.test/${id}.jpg`, art_crop: `https://cards.test/${id}-a.jpg` },
      prices: { eur: '0.50' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    globalThis.__card = card;
    const COMMANDER = card('niv-1', 'Niv-Mizzet, Parun', 6, 'Legendary Creature — Dragon Wizard', 'Flying', ['U', 'R']);
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        const pages = globalThis.__pages || [[card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste')]];
        const n = Number(u.searchParams.get('page') || '1');
        const data = pages[n - 1] || [];
        const total = pages.reduce((s, p) => s + p.length, 0);
        const next = new URL(u.href); next.searchParams.set('page', String(n + 1));
        body = { object: 'list', total_cards: total, data, has_more: n < pages.length, ...(n < pages.length ? { next_page: next.href } : {}) };
      } else if (u.pathname === '/cards/niv-1') body = COMMANDER;
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
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        globalThis.__filterCalls.push(last);
        text = globalThis.__judge(last);
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

async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  expect(r && r.ok, JSON.stringify(r)).toBe(true);
  return deckId;
}

async function send(page, text) {
  const bots = page.locator('.dk-msg-bot');
  const before = await bots.count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(bots).toHaveCount(before + 1);
  const bubble = bots.nth(before);
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 20_000 });
  return bubble;
}

test('carte che danno haste: quella giusta a pagina 2 dei risultati larghi si vede', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    // Pagina 1: 175 creature economiche che HANNO haste (da scartare), una sola che la DÀ.
    const p1 = [card('greaves-1', 'Lightning Greaves', 2, 'Artifact — Equipment', 'Equipped creature has haste and shroud. Equip {0}')];
    for (let i = 1; i < 175; i++) p1.push(card(`hasty-${i}`, `Hasty Goblin ${i}`, 1, 'Creature — Goblin', 'Haste'));
    // Pagina 2: quelle a costo più alto, fra cui una che dà haste a tutte.
    const p2 = [
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
      card('ogre-1', 'Hasty Ogre', 4, 'Creature — Ogre', 'Haste'),
    ];
    globalThis.__pages = [p1, p2];
    globalThis.__chat = () => JSON.stringify({
      reply: 'Cerco carte che danno haste.',
      query: '(o:"gains haste" or o:"have haste" or o:haste)',
      filter: 'fa guadagnare haste ad altre creature',
    });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. (Lightning Greaves|Hammer of Purphoros) /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste');
  await page.screenshot({ path: 'tests/.shots/verifica-382-pagine.png' });
  const judged = await app.evaluate(() => globalThis.__filterCalls.join('\n'));
  // SUCCESSO: il giudice ha visto anche le carte oltre la prima pagina, e quella giusta compare.
  expect(judged).toContain('Hammer of Purphoros');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Lightning Greaves');
});

test('nessuna delle prime 175 va bene: la chat non dice «nessuna corrisponde» se ce ne sono altre non guardate', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    const p1 = [];
    for (let i = 1; i <= 175; i++) p1.push(card(`hasty-${i}`, `Hasty Goblin ${i}`, 1, 'Creature — Goblin', 'Haste'));
    const p2 = [card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.')];
    globalThis.__pages = [p1, p2];
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Hammer of Purphoros /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const bubble = await send(page, 'carte che danno haste a tutte le creature');
  await expect(bubble).not.toContainText('nessuna corrisponde');
  await expect(bubble.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
});
