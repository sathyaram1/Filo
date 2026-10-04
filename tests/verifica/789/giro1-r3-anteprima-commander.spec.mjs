// Verifica #789 giro 1, rilievo 3: l'anteprima del commander dice che è il commander, come il carosello,
// non «già nel mazzo».

import { test, expect } from '../../fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cost, cmc, type, colors, slug) => ({
      id, name, mana_cost: cost, cmc, type_line: type, colors, color_identity: colors,
      image_uris: { normal: `https://cards.test/${slug}.jpg`, art_crop: `https://cards.test/${slug}-art.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${slug}`,
    });
    const NIV = card('niv-1', 'Niv-Mizzet, Parun', '{U}{U}{U}{R}{R}{R}', 6, 'Legendary Creature — Dragon Wizard', ['U', 'R'], 'niv');
    const ATX = card('atx-1', 'Atraxa, Praetors\' Voice', '{G}{W}{U}{B}', 4, 'Legendary Creature — Phyrexian Angel Horror', ['W', 'U', 'B', 'G'], 'atx');
    const BOLT = card('bolt-1', 'Lightning Bolt', '{R}', 1, 'Instant', ['R'], 'bolt');
    const ELF = card('elf-1', 'Llanowar Elves', '{G}', 1, 'Creature — Elf Druid', ['G'], 'elf');
    const ALL = [NIV, ATX, BOLT, ELF];
    const BY_ID = Object.fromEntries(ALL.map((c) => [c.id, c]));
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [NIV, ATX, BOLT, ELF], has_more: false };
      else if (u.pathname === '/cards/named') {
        const q = String(u.searchParams.get('fuzzy') || u.searchParams.get('exact') || '').toLowerCase();
        body = ALL.find((c) => c.name.toLowerCase().startsWith(q.slice(0, 5))) || null;
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
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      const text = /^is:commander/.test(last)
        ? JSON.stringify({ query: 'is:commander' })
        : /incollo/i.test(last)
          ? JSON.stringify({ reply: 'Lista letta.', commander: 'Atraxa, Praetors\' Voice', import: [{ name: 'Lightning Bolt', qty: 1 }] })
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

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  return page.evaluate(() => decodeURIComponent(location.hash.replace('#/deck/', '')));
}
const getDeck = (page, id) => page.evaluate(async (deckId) =>
  (await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_GET, id: deckId })).deck, id);
async function setCmd(page, id, cmd) {
  await page.evaluate(async ({ id, cmd }) => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: cmd });
  }, { id, cmd });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}
const menu = (page) => page.locator('.dk-ctxmenu .sn-select-option');

test('anteprima del commander dall\'intestazione: dice commander', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await setCmd(page, deckId, 'niv-1');
  await page.locator('#commanderLine .dk-prose-card').hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewCtx')).toContainText('commander');
  await expect(page.locator('#previewCtx')).not.toContainText('già nel mazzo');
});
