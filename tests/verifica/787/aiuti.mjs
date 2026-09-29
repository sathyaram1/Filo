// #787 — aiuti delle prove del primo giro: Scryfall e modello finti nel main, mazzo nuovo, domanda in chat.

import { expect } from '../../fixtures/electron.mjs';

export async function mockScryfall(app) {
  await app.evaluate(() => {
    const mk = (id, name, cmc, type, cost) => ({
      id, name, mana_cost: cost, cmc, type_line: type, colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg`, art_crop: `https://cards.test/${id}-art.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const NIV = { ...mk('niv-1', 'Niv-Mizzet, Parun', 6, 'Legendary Creature — Dragon Wizard', '{U}{U}{U}{R}{R}{R}'), colors: ['U', 'R'], color_identity: ['U', 'R'] };
    const BOLT = mk('bolt-1', 'Lightning Bolt', 1, 'Instant', '{R}');
    const CRASHER = mk('crasher-1', 'Embercleave Crasher', 4, 'Creature — Ogre', '{2}{R}{R}');
    const BY_ID = { 'niv-1': NIV, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [CRASHER, BOLT], has_more: false };
      else if (u.pathname === '/cards/named') body = BOLT;
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
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
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chatCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      if (globalThis.__hang) await new Promise((r) => { globalThis.__release = r; });
      const last = String(messages[messages.length - 1].content || '');
      const text = /haste/i.test(last)
        ? JSON.stringify({ reply: 'Per la fretta guarda [[Lightning Bolt]].', query: 'o:haste' })
        : JSON.stringify({ reply: 'Il mazzo mi sembra a buon punto.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onReasoning }) => {
      for (const t of (globalThis.__reasoningChunks || [])) { try { onReasoning && onReasoning(t); } catch (_) {} }
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

export async function newDeck(page, withCommander = true) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  if (withCommander) {
    const r = await page.evaluate((id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
    expect(r && r.ok).toBe(true);
  }
  return deckId;
}

export async function ask(page, text, bots) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(bots);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0);
}

export async function storedChats(app) {
  return app.evaluate(async () => {
    const k = globalThis.SN_CONST.STORAGE_KEYS.DECK_CHATS;
    const r = await chrome.storage.local.get(k);
    return r[k] || {};
  });
}

export async function reloadBuilder(page) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

export async function seedChat(app, deckId, n, { reasoning = 0, ids = 0 } = {}) {
  await app.evaluate(async (_e, { deckId, n, reasoning, ids }) => {
    const k = globalThis.SN_CONST.STORAGE_KEYS.DECK_CHATS;
    const messages = [];
    for (let i = 0; i < n / 2; i += 1) {
      messages.push({ who: 'user', text: `domanda ${i}` });
      const bot = { who: 'bot', reply: `risposta ${i} con [[Lightning Bolt]]` };
      if (reasoning) bot.reasoning = 'r'.repeat(reasoning);
      if (ids) { bot.cardIds = Array.from({ length: ids }, (_, j) => (j % 2 ? 'bolt-1' : 'crasher-1') + (j > 1 ? `-${j}` : '')); bot.query = 'o:haste'; }
      messages.push(bot);
    }
    await chrome.storage.local.set({ [k]: { [deckId]: { messages, updatedAt: Date.now() } } });
  }, { deckId, n, reasoning, ids });
}
