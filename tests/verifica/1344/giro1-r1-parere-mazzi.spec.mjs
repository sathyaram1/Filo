// Verifica #1344, giro 1: il «Parere di Filo» di una carta quando la richiesta non va (crediti finiti).

import { test, expect } from '../../fixtures/electron.mjs';

// Mini-API Scryfall finta (stesse carte di decks-chat.spec.mjs).
async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1',
      name: 'Niv-Mizzet, Parun',
      mana_cost: '{U}{U}{U}{R}{R}{R}',
      cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard',
      oracle_text: 'Whenever you draw a card, deal 1 damage to any target.',
      colors: ['U', 'R'],
      color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/niv',
    };
    const BOLT = {
      id: 'bolt-1',
      name: 'Lightning Bolt',
      mana_cost: '{R}',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/bolt.jpg' },
      prices: { eur: '1.10' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/bolt',
    };
    const CRASHER = {
      id: 'crasher-1',
      name: 'Embercleave Crasher',
      mana_cost: '{2}{R}{R}',
      cmc: 4,
      type_line: 'Creature — Ogre',
      oracle_text: 'Trample.',
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/crasher.jpg' },
      prices: { eur: '0.30' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/crasher',
    };
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        // `unique=prints` = conteggio ristampe del modulo "Prezzo e dati".
        if (u.searchParams.get('unique') === 'prints') body = { total_cards: 42, data: [] };
        else body = { data: [CRASHER, BOLT], has_more: false };
      } else if (u.pathname === '/cards/named') body = BOLT;
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{2}', svg_uri: 'https://svgs.test/2.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// La chat funziona (serve ad aggiungere la carta), il parere risponde come un servizio coi crediti finiti.
async function parereSenzaCrediti(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash',
        [C.ACTIONS.DECKS_OPINION]: 'deepseek-flash',
        [C.ACTIONS.DECKS_AUTOTAG]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__calls = { opinion: 0 };
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      if (last.includes('CARTE DA VALUTARE')) {
        globalThis.__calls.opinion++;
        const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
        e.status = 402; e.provider = 'openrouter';
        throw e;
      }
      const text = /haste/i.test(last) ? JSON.stringify({ reply: 'Ecco.', query: 'o:haste' }) : JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

test('r1 parere di una carta coi crediti finiti: una richiesta, non una raffica, e la frase al posto di «Chiedo un parere»', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await parereSenzaCrediti(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await bubble.locator('[data-add="bolt-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toBeVisible();

  await page.hover('#deckList .dk-row[data-card-id="bolt-1"]');
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await page.hover('#deckList .dk-row[data-card-id="bolt-1"]');
  await expect(page.locator('#previewModule .dk-module-title')).toHaveText('Parere di Filo');
  const prima = await app.evaluate(() => globalThis.__calls.opinion);
  await page.waitForTimeout(4000);
  const dopo = await app.evaluate(() => globalThis.__calls.opinion);
  await page.screenshot({ path: 'tests/.shots/1344-parere-crediti.png' }).catch(() => {});
  console.log('richieste di parere in 4 s:', dopo - prima, 'totale', dopo);
  expect(dopo - prima, 'richieste ripetute da sole a carta ferma').toBeLessThanOrEqual(1);
  await expect(page.locator('#previewModule')).toContainText(/Crediti|crediti/);
});
