// Debug verifier #343: isola la causa del mancato avanzamento del carosello
// quando nel messaggio c'è un nome irrisolvibile e/o si clicca due volte.

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
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    const byName = {};
    for (const c of Object.values(CARDS)) byName[c.name.toLowerCase()] = c;
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (u.pathname === '/cards/named') {
        const q = (u.searchParams.get('fuzzy') || u.searchParams.get('exact') || '').toLowerCase();
        body = byName[q] || null;
      } else if (m && CARDS[m[1]]) body = CARDS[m[1]];
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

async function mockProvider(app, replyText) {
  await app.evaluate(async (electron, reply) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ reply }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  }, replyText);
}

async function setup(app, openTab, reply) {
  await mockScryfall(app);
  await mockProvider(app, reply);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.fill('#chatInput', 'consigli?');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-msg-text')).toBeVisible();
  return { page, bubble };
}

test('A: nome irrisolvibile presente, click SINGOLO con attesa', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const { page, bubble } = await setup(app, openTab,
    'Considera [[Carta Inesistente Xyz]], poi [[Lightning Bolt]] e [[Shivan Dragon]].');
  const spans = bubble.locator('.dk-prose-card');
  await expect(spans).toHaveCount(3);

  await spans.nth(1).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg', { timeout: 10_000 });
  await page.waitForTimeout(1500); // lascia finire ogni risoluzione in corso
  const pos = await page.locator('#carouselPos').textContent();
  console.log('POS-A dopo click singolo:', pos);
  await page.click('#carouselNext');
  await page.waitForTimeout(500);
  const src = await page.locator('#carouselImg').getAttribute('src');
  const pos2 = await page.locator('#carouselPos').textContent();
  console.log('POS-A dopo next:', pos2, 'src:', src);
  expect(src).toBe('https://cards.test/dragon.jpg');
});

test('B: nessun irrisolvibile, doppio click rapido', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const { page, bubble } = await setup(app, openTab,
    'Considera [[Lightning Bolt]] e [[Shivan Dragon]].');
  const spans = bubble.locator('.dk-prose-card');
  await expect(spans).toHaveCount(2);

  await spans.nth(0).click();
  await spans.nth(0).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  const pos = await page.locator('#carouselPos').textContent();
  console.log('POS-B dopo doppio click:', pos);
  await page.click('#carouselNext');
  await page.waitForTimeout(500);
  const src = await page.locator('#carouselImg').getAttribute('src');
  console.log('POS-B dopo next:', await page.locator('#carouselPos').textContent(), 'src:', src);
  expect(src).toBe('https://cards.test/dragon.jpg');
});
