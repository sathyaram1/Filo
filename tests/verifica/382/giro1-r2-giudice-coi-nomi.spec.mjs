// #382 verifica giro 1: un giudice che risponde coi NOMI delle carte invece dei numeri non deve far dire
// «nessuna corrisponde», né restare scritto così per sempre: la stessa ricerca ripetuta deve tornare a funzionare.
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

test('giudice coi nomi: niente falso «nessuna corrisponde», e la ricerca ripetuta non resta bloccata', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const card = globalThis.__card;
    globalThis.__pages = [[
      card('guide-1', 'Goblin Guide', 1, 'Creature — Goblin Scout', 'Haste'),
      card('hammer-1', 'Hammer of Purphoros', 3, 'Legendary Enchantment Artifact', 'Creatures you control have haste.'),
    ]];
    globalThis.__chat = () => JSON.stringify({ query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = () => JSON.stringify({ keep: ['Hammer of Purphoros'] });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  const first = await send(page, 'carte che danno haste');
  await page.screenshot({ path: 'tests/.shots/verifica-382-nomi.png' });
  await expect(first).not.toContainText('nessuna corrisponde');

  // Il giudice torna a rispondere coi numeri: la stessa richiesta deve mostrare la carta giusta.
  await app.evaluate(() => {
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Hammer of Purphoros /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  });
  const again = await send(page, 'carte che danno haste');
  await expect(again.locator('.dk-cardlist')).toContainText('Hammer of Purphoros');
  await expect(again.locator('.dk-cardlist')).not.toContainText('Goblin Guide');
});
