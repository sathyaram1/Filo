// Finti di Scryfall e del fornitore AI per le prove di verifica di #382, sul cammino IPC reale della chat dei mazzi.
// Stesso schema di tests/decks-search-filter.spec.mjs: `__chat` risponde al modello della chat, `__judge` al giudice.
import { expect } from '../../fixtures/electron.mjs';

export async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/niv',
    };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        const pages = globalThis.__pages || [globalThis.__searchCards || []];
        const n = Number(u.searchParams.get('page') || '1');
        body = { data: pages[n - 1] || [], has_more: n < pages.length, total_cards: pages.reduce((t, p) => t + p.length, 0) };
        if (!body.data.length && n === 1) body = null;
      } else if (u.pathname === '/cards/niv-1') body = COMMANDER;
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

export async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.DECKS_SEARCH_FILTER]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__filterCalls = [];
    globalThis.__chatCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        globalThis.__filterCalls.push(last);
        if (globalThis.__judgeGate) await globalThis.__judgeGate;
        text = globalThis.__judge(last);
      } else {
        globalThis.__chatCalls.push(messages);
        text = globalThis.__chat(last, messages);
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

// Le carte della segnalazione: una creatura che HA haste (da scartare) e un equipaggiamento che la DÀ.
export async function hasteCards(app) {
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
    // Giudice onesto: tiene chi DÀ haste quando il criterio lo chiede.
    globalThis.__judge = (prompt) => {
      const [head, rest = ''] = prompt.split('CARTE CANDIDATE:');
      const lines = rest.split('\n').filter((l) => /^\d+\. /.test(l));
      const keep = /danno haste|haste ad altre/i.test(head) ? lines.filter((l) => /have haste/.test(l)) : lines;
      return JSON.stringify({ keep: keep.map((l) => Number(l.split('.')[0])) });
    };
  });
}

export async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1',
  }), deckId);
  expect(r && r.ok, JSON.stringify(r)).toBe(true);
  return deckId;
}

// La bolla di QUESTO turno, a risposta arrivata.
export async function send(page, text) {
  const bots = page.locator('.dk-msg-bot');
  const before = await bots.count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(bots).toHaveCount(before + 1);
  const bubble = bots.nth(before);
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 30_000 });
  return bubble;
}
