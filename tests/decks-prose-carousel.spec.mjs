// Carosello dal testo libero della chat (#343): cliccando un nome carta in
// prosa ([[...]]) il carosello deve navigare TUTTE le carte citate in quella
// bolla (frecce funzionanti), non aprire una lista da 1 sola carta; e la
// carta ATTUALMENTE mostrata deve risultare evidenziata nel testo (fondo
// d'accento, niente sottolineatura) e nelle righe del mazzo. Scryfall e
// provider LLM mockati nel main: niente rete. Si asserisce il SUCCESSO
// (navigazione reale tra le carte, evidenziazione che segue e sopravvive al
// rerender), non l'assenza di errori.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg', art_crop: 'https://cards.test/bolt-art.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  },
  'c-goblin': {
    id: 'c-goblin', name: 'Goblin Guide', mana_cost: '{R}', cmc: 1,
    type_line: 'Creature — Goblin Scout', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/goblin.jpg', art_crop: 'https://cards.test/goblin-art.jpg' },
    prices: { eur: '2.10' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/goblin',
  },
  'c-dragon': {
    id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6,
    type_line: 'Legendary Creature — Dragon', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/dragon.jpg', art_crop: 'https://cards.test/dragon-art.jpg' },
    prices: { eur: '0.90' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/dragon',
  },
};

// Scryfall finto: /cards/named risolve per nome fuzzy (lowercase), /cards/<id>
// per id — così i [[Nomi]] in prosa si risolvono davvero, uno per uno.
async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (u.pathname === '/cards/named') {
        const q = String(u.searchParams.get('fuzzy') || '').toLowerCase();
        body = Object.values(CARDS).find((c) => c.name.toLowerCase() === q) || null;
      } else if (m && CARDS[m[1]]) {
        body = CARDS[m[1]];
      } else if (u.pathname === '/symbology') {
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

// Provider LLM finto: risposta SOLO testuale (nessuna query → nessuna
// CardList) che cita tre carte in prosa — il caso del feedback #343.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ reply: 'Ti consiglio [[Lightning Bolt]], [[Goblin Guide]] e [[Shivan Dragon]].' }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
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
}

test('click su un nome in prosa: il carosello naviga tutte le carte citate e la carta mostrata è evidenziata', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  // Risposta SOLO testuale con tre nomi in prosa (nessuna CardList).
  await page.fill('#chatInput', 'consigliami rimozioni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-prose-card')).toHaveCount(3);
  await expect(bubble.locator('.dk-cardlist')).toHaveCount(0);

  // Click sul SECONDO nome (Goblin Guide): il carosello apre su di lui e —
  // questo è il fix — la lista è TUTTA la bolla (3 carte), non 1 sola.
  await bubble.locator('.dk-prose-card', { hasText: 'Goblin Guide' }).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/goblin.jpg');
  await expect(page.locator('#carouselPos')).toHaveText('2/3');

  // Il nome mostrato è EVIDENZIATO (fondo, niente sottolineatura); gli altri
  // restano sottolineati e non evidenziati.
  const goblinSpan = bubble.locator('.dk-prose-card', { hasText: 'Goblin Guide' });
  const dragonSpan = bubble.locator('.dk-prose-card', { hasText: 'Shivan Dragon' });
  await expect(goblinSpan).toHaveClass(/dk-carousel-current/);
  await expect(dragonSpan).not.toHaveClass(/dk-carousel-current/);
  const deco = await goblinSpan.evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(deco).toBe('none');
  const bg = await goblinSpan.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  const decoOther = await dragonSpan.evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoOther).toBe('underline');

  // Traccia visiva (tests/.shots/, gitignorata): evidenziazione sul nome.
  await page.screenshot({ path: 'tests/.shots/decks-prose-carousel-highlight.png' }).catch(() => {});

  // La freccia → FUNZIONA anche dal testo libero: passa a Shivan Dragon e
  // l'evidenziazione lo segue.
  await page.click('#carouselNext');
  await expect(page.locator('#carouselPos')).toHaveText('3/3');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg');
  await expect(dragonSpan).toHaveClass(/dk-carousel-current/);
  await expect(goblinSpan).not.toHaveClass(/dk-carousel-current/);

  // ← due volte: si arriva alla prima (Lightning Bolt), poi si ferma lì.
  await page.click('#carouselPrev');
  await page.click('#carouselPrev');
  await expect(page.locator('#carouselPos')).toHaveText('1/3');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg');

  // "aggiungi" dal carosello di prosa FUNZIONA: il Bolt entra nel mazzo, e
  // dopo il rerender l'evidenziazione resta sia sul nome in prosa sia sulla
  // riga nuova del mazzo (stessa carta, stessa evidenza).
  await page.click('#carouselToggle');
  await expect(page.locator('#deckList .dk-row[data-card-id="c-bolt"]')).toBeVisible();
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '1');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-prose-card', { hasText: 'Lightning Bolt' }))
    .toHaveClass(/dk-carousel-current/);
  await expect(page.locator('#deckList .dk-row[data-card-id="c-bolt"]')).toHaveClass(/dk-carousel-current/);

  // Esc chiude: nessuna evidenziazione residua da nessuna parte.
  await page.keyboard.press('Escape');
  await expect(page.locator('#stateStats')).toBeVisible();
  await expect(page.locator('.dk-carousel-current')).toHaveCount(0);
});

test('il carosello aperto da una riga del mazzo evidenzia la riga corrente e segue le frecce', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    for (const cid of ['c-bolt', 'c-dragon']) deck = window.SN_DECKS.addCard(deck, cid, { qty: 1 }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckList .dk-row')).toHaveCount(2);

  // Click sulla riga del drago → carosello; la riga cliccata è evidenziata.
  await page.locator('#deckList .dk-row', { hasText: 'Shivan Dragon' }).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#deckList .dk-row[data-card-id="c-dragon"]')).toHaveClass(/dk-carousel-current/);
  await expect(page.locator('#deckList .dk-row[data-card-id="c-bolt"]')).not.toHaveClass(/dk-carousel-current/);

  // Navigando, l'evidenza segue la carta mostrata.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#deckList .dk-row[data-card-id="c-bolt"]')).toHaveClass(/dk-carousel-current/);
  await expect(page.locator('#deckList .dk-row[data-card-id="c-dragon"]')).not.toHaveClass(/dk-carousel-current/);

  // Chiuso il carosello, nessuna riga resta evidenziata.
  await page.keyboard.press('Escape');
  await expect(page.locator('.dk-carousel-current')).toHaveCount(0);
});
