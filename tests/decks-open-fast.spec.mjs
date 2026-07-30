// Apertura del mazzo (feedback #380): all'apertura le carte del mazzo devono
// comparire SUBITO dai dati di cache (nomi, tipi, costi — statici, non scadono),
// SENZA aspettare il refresh dei PREZZI, che è serializzato e lento su un mazzo
// intero e va fatto in background.
//
// Il test riproduce il caso reale: un mazzo già aperto (carte in cache) viene
// riaperto quando i prezzi sono stantii (>6h) → il refresh prezzi tocca la rete.
// Qui la rete per i prezzi VIENE FATTA PENDERE ALL'INFINITO: se l'elenco
// aspettasse quel refresh (il bug) le righe non comparirebbero mai. Col fix,
// l'elenco compare dalla cache e il refresh prezzi resta appeso in background
// senza bloccare nulla.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg', art_crop: 'https://cards.test/bolt-art.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  },
  'c-dragon': {
    id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6,
    type_line: 'Legendary Creature — Dragon', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/dragon.jpg', art_crop: 'https://cards.test/dragon-art.jpg' },
    prices: { eur: '0.90' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/dragon',
  },
  'c-island': {
    id: 'c-island', name: 'Island', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Island', colors: [], color_identity: ['U'],
    image_uris: { normal: 'https://cards.test/island.jpg', art_crop: 'https://cards.test/island-art.jpg' },
    prices: {}, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/island',
  },
};

// Fetch mock che serve le carte e la symbology (fase di seed, cache calda).
async function mockScryfallOk(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (m && CARDS[m[1]]) body = CARDS[m[1]];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{4}', svg_uri: 'https://svgs.test/4.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

// Invecchia i prezzi in cache (fetchedAt vecchio di 7h) così un refresh
// "freshPrices" li considera stantii e TENTA la rete; e sostituisce il fetch
// con uno che sulle carte NON risponde MAI (la symbology resta in cache).
async function ageCacheAndHangCardFetch(app) {
  await app.evaluate(async () => {
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.SCRYFALL_CARDS;
    const res = await chrome.storage.local.get(KEY);
    const map = (res && res[KEY]) || {};
    const old = Date.now() - 7 * 60 * 60 * 1000; // > TTL prezzi (6h)
    for (const id of Object.keys(map)) {
      if (map[id]) map[id].fetchedAt = old;
    }
    await chrome.storage.local.set({ [KEY]: map });
    // Il fetch delle carte pende all'infinito: solo un elenco che NON aspetta
    // il refresh prezzi (il fix) può comparire.
    globalThis.SN_SCRYFALL._setFetch((url) => {
      const u = new URL(String(url));
      if (u.pathname === '/symbology') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{4}', svg_uri: 'https://svgs.test/4.svg' },
        ] }) });
      }
      return new Promise(() => {}); // /cards/<id>: mai risolto
    });
  });
}

async function seedDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    for (const [cid, qty] of [['c-bolt', 1], ['c-dragon', 1], ['c-island', 10]]) {
      deck = window.SN_DECKS.addCard(deck, cid, { qty }).deck;
    }
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dk-row')).toHaveCount(3);
  return deckId;
}

test('le carte del mazzo compaiono subito all\'apertura, senza aspettare i prezzi', async ({ app, openTab }) => {
  await mockScryfallOk(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedDeck(page); // carte ora in cache (statici + prezzi)

  // Prezzi stantii + rete carte appesa: solo la cache può far comparire l'elenco.
  await ageCacheAndHangCardFetch(app);

  // Riapri il mazzo come farebbe l'app all'avvio.
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; location.reload(); }, deckId);
  await page.waitForLoadState('domcontentloaded');

  // Le righe carta devono comparire — dai NOMI reali (cache), non dagli id —
  // benché il refresh prezzi sia bloccato in background.
  await expect(page.locator('.dk-row')).toHaveCount(3, { timeout: 4000 });
  await expect(page.locator('.dk-row', { hasText: 'Lightning Bolt' })).toHaveCount(1);
  await expect(page.locator('.dk-row', { hasText: 'Shivan Dragon' })).toHaveCount(1);
  await expect(page.locator('.dk-row', { hasText: 'Island' })).toContainText('10×');
  // I gruppi per tipo sono renderizzati (l'elenco è pienamente utilizzabile).
  await expect(page.locator('.dk-group-head')).toHaveCount(3);
});
