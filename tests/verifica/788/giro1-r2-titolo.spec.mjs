// #788 giro 1, rilievo 2: il titolo del modello si legge dopo il numero della lista, anche se il modello lo scrive
// con la maiuscola o col suo numero davanti.

import { test, expect } from '../../fixtures/electron.mjs';

async function finti(app) {
  await app.evaluate(async () => {
    const mk = (id, name, cmc, eur) => ({
      id, name, mana_cost: '{R}', cmc, type_line: 'Instant', colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg` }, prices: { eur }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const NIV = { ...mk('niv-1', 'Niv-Mizzet, Parun', 6, '3.21'), color_identity: ['U', 'R'], type_line: 'Legendary Creature — Dragon' };
    const CARDS = [mk('a-1', 'Zap', 3, '0.30'), mk('b-1', 'Bolt', 1, '1.10'), mk('c-1', 'Anvil', 2, null)];
    const BY = { 'niv-1': NIV };
    for (const c of CARDS) BY[c.id] = c;
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: globalThis.__v_cards || CARDS, has_more: false };
      else if (BY[u.pathname.replace('/cards/', '')]) body = BY[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const prompt = String(messages[messages.length - 1].content || '');
      if (/CARTE CANDIDATE/.test(prompt)) {
        const keep = (prompt.match(/^\d+(?=\. )/gm) || []).map(Number);
        return { text: JSON.stringify({ keep }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      const text = /cerca/i.test(prompt)
        ? JSON.stringify({ reply: 'Eccole.', query: 'o:haste', filter: 'dà haste', ...(globalThis.__v_title !== undefined ? { title: globalThis.__v_title } : {}) })
        : JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback(args);
      if (args.onDelta) args.onDelta(r.text);
      return r;
    };
  });
}

async function mazzo(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const id = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (deckId) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id: deckId, scryfallId: 'niv-1' }), id);
  return id;
}

async function chiedi(page, text, n) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(n);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending')).toHaveCount(0, { timeout: 15_000 });
}

test('il titolo del modello si legge bene dopo il numero', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await finti(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await mazzo(page);

  await app.evaluate(() => { globalThis.__v_title = 'Carte che danno rapidità'; });
  await chiedi(page, 'cerca 1', 1);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-list-title')).toHaveText('3 carte che danno rapidità');

  await app.evaluate(() => { globalThis.__v_title = '3 modi per vincere'; });
  await chiedi(page, 'cerca 2', 2);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-list-title')).not.toHaveText(/^\d+ \d+ /);
});
