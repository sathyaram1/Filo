import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const card = (id, name, cmc, eur) => ({ id, name, mana_cost: '{R}', cmc, type_line: 'Instant', colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg` }, prices: { eur }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/' + id });
    const COMMANDER = { ...card('niv-1', 'Niv-Mizzet, Parun', 6, '3.21'), type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'] };
    const BY_ID = { 'niv-1': COMMANDER };
    const DATA = [card('c-1', 'Zeta Crasher', 4, '0.30'), card('b-1', 'Alpha Bolt', 1, '1.10'), card('n-1', 'Mid Thing', 2, null)];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: DATA, has_more: false };
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
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
      if (!/CARTE CANDIDATE/.test(prompt)) (globalThis.__chiamate ||= []).push(messages.map((m) => String(m.content || '')).join('\n'));
      let text;
      if (/CARTE CANDIDATE/.test(prompt)) text = JSON.stringify({ keep: (prompt.match(/^\d+(?=\. )/gm) || []).map(Number) });
      else {
        const k = Object.keys(risposte).find((x) => prompt.includes(x));
        text = JSON.stringify(k ? risposte[k] : { reply: 'ok' });
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (a) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback(a);
      if (a.onDelta) a.onDelta(r.text);
      return r;
    };
  }, risposte);
}

async function mazzo(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
}

async function chiedi(page, t) {
  const n = await page.locator('.dk-msg-bot').count();
  await page.fill('#chatInput', t);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(n + 1);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending')).toHaveCount(0, { timeout: 20_000 });
}

// Il menu della lista sa mostrare la ricerca esatta e aprirla su Scryfall: chiesto a parole, il modello deve almeno
// sapere quale ricerca ha prodotto la lista di prima, altrimenti non può né dirla né aprirla.
test('chiesta in chat, la ricerca esatta della lista di prima è nota a Filo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await prepara(app, {
    haste: { reply: 'Eccole.', query: 'o:haste', title: 'carte che danno rapidità' },
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await mazzo(page);
  await chiedi(page, 'carte con haste');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-row')).toHaveCount(3);
  await chiedi(page, 'che ricerca hai usato per la lista di prima? aprimela su Scryfall');
  const ultima = await app.evaluate(() => globalThis.__chiamate[globalThis.__chiamate.length - 1]);
  expect(ultima).toContain('o:haste id<=UR');
});
