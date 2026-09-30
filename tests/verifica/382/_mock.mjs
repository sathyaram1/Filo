// Mock condivisi delle prove di verifica #382: Scryfall e provider LLM finti nel main, cammino IPC reale.
import { expect } from '../../fixtures/electron.mjs';

export async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cmc, type, oracle, ci = ['R']) => ({
      id, name, mana_cost: `{${cmc}}`, cmc, type_line: type, oracle_text: oracle,
      colors: ci, color_identity: ci, image_uris: { normal: `https://cards.test/${id}.jpg`, art_crop: `https://cards.test/${id}-a.jpg` },
      prices: { eur: '0.50' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    globalThis.__card = card;
    const COMMANDER = card('niv-1', 'Niv-Mizzet, Parun', 6, 'Legendary Creature — Dragon Wizard',
      'Flying. Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target. Whenever a player casts an instant or sorcery spell, you draw a card.', ['U', 'R']);
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
        body = { object: 'list', total_cards: total, data, has_more: n < pages.length };
      } else if (u.pathname === '/cards/niv-1') body = COMMANDER;
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// `__judge(prompt, model)`: il modello che risponde è quello scelto nelle impostazioni per il giudice.
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
    globalThis.__judgeModels = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (/CARTE CANDIDATE/.test(last)) {
        globalThis.__filterCalls.push(last);
        globalThis.__judgeModels.push(attempts[0].model);
        if (globalThis.__judgeGate) await globalThis.__judgeGate;
        text = globalThis.__judge(last, attempts[0].model);
      } else {
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

// Carte su più pagine: le «Giusta» danno haste, le altre la hanno soltanto. Il giudice finto tiene le «Giusta».
export async function manyCards(app, { pages, relevant = [] }) {
  await app.evaluate((_electron, { pages, relevant }) => {
    const card = globalThis.__card;
    let k = 0;
    globalThis.__pages = pages.map((size, p) => Array.from({ length: size }, () => {
      k += 1;
      const hit = relevant.includes(k);
      return card(`c-${k}`, hit ? `Giusta ${k}` : `Carta ${k}`, p + 1, 'Artifact',
        hit ? 'Creatures you control have haste.' : 'Haste. When this enters, it deals 1 damage to any target and you may discard a card, then draw a card.');
    }));
    globalThis.__chat = () => JSON.stringify({ reply: 'Cerco carte che danno haste.', query: '(o:"have haste" or o:haste)', filter: 'fa guadagnare haste ad altre creature' });
    globalThis.__judge = (prompt) => JSON.stringify({
      keep: prompt.split('\n').filter((l) => /^\d+\. Giusta /.test(l)).map((l) => Number(l.split('.')[0])),
    });
  }, { pages, relevant });
}

export async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  expect(r && r.ok, JSON.stringify(r)).toBe(true);
  return deckId;
}

export async function send(page, text, timeout = 30_000) {
  const bots = page.locator('.dk-msg-bot');
  const before = await bots.count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(bots).toHaveCount(before + 1);
  const bubble = bots.nth(before);
  await expect(bubble.locator('.dk-msg-pending')).toHaveCount(0, { timeout });
  return bubble;
}
