import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': { id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg' }, prices: { eur: '1.50' },
    legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/bolt' },
  'c-mountain': { id: 'c-mountain', name: 'Mountain', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Mountain', colors: [], color_identity: ['R'], produced_mana: ['R'],
    image_uris: { normal: 'https://cards.test/mountain.jpg' }, prices: { eur: '0.10' },
    legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/mountain' },
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (m && CARDS[m[1]]) body = CARDS[m[1]];
      else if (u.pathname === '/symbology') body = { data: [{ symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' }] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

test('repro prob-row label vs input widths', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    deck = window.SN_DECKS.addCard(deck, 'c-bolt').deck;
    deck = window.SN_DECKS.addCard(deck, 'c-mountain').deck;
    // long-ish tag names like the screenshot
    deck = window.SN_DECKS.addTagToCard(deck, 'c-bolt', 'ragionamento');
    deck = window.SN_DECKS.addTagToCard(deck, 'c-bolt', 'rimozione');
    deck = window.SN_DECKS.addTagToCard(deck, 'c-bolt', 'counters');
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckList .dk-row')).toHaveCount(2);

  // widen the right column like the user did in the screenshot
  await page.evaluate(() => {
    const grid = document.getElementById('builderGrid');
    grid.style.gridTemplateColumns = `340px 6px minmax(0,1fr) 6px 640px`;
  });
  await page.waitForTimeout(100);

  const rows = page.locator('#probNeeds .dk-prob-row');
  const n = await rows.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const lb = await row.locator('label').boundingBox();
    const ib = await row.locator('input').boundingBox();
    const tag = await row.locator('input').getAttribute('data-tag');
    const labelText = await row.locator('label').textContent();
    const clip = await row.locator('label').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    out.push({ tag, labelText, labelW: Math.round(lb.width), inputW: Math.round(ib.width), clipped: clip });
  }
  // turno row too
  const turnRow = page.locator('.dk-prob-row').first();
  const tlb = await turnRow.locator('label').boundingBox();
  const tib = await turnRow.locator('input').boundingBox();
  const tclip = await turnRow.locator('label').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  console.log('TURNO', { labelW: Math.round(tlb.width), inputW: Math.round(tib.width), clipped: tclip });
  console.log('PROBROWS', JSON.stringify(out, null, 2));
  await page.screenshot({ path: 'tests/.shots/prob-repro.png' });
});
