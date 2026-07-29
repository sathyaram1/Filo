import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg', art_crop: 'https://cards.test/bolt-art.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
  },
  'c-delver': {
    id: 'c-delver', name: 'Delver of Secrets // Insectile Aberration',
    cmc: 1, color_identity: ['U'],
    card_faces: [
      { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard',
        colors: ['U'], image_uris: { normal: 'https://cards.test/delver-front.jpg', art_crop: 'https://cards.test/delver-art.jpg' } },
      { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect',
        image_uris: { normal: 'https://cards.test/delver-back.jpg' } },
    ],
    prices: { eur: '0.30' }, legalities: { commander: 'legal' },
  },
  // Edge: due facce ma la faccia 2 NON ha image_uris (meld-part / anomalia) →
  // niente retro reale → NON deve mostrare il tasto gira.
  'c-weird': {
    id: 'c-weird', name: 'Weird Two // No Back Art',
    cmc: 2, color_identity: ['G'],
    card_faces: [
      { name: 'Weird Two', mana_cost: '{G}', type_line: 'Creature', colors: ['G'],
        image_uris: { normal: 'https://cards.test/weird-front.jpg', art_crop: 'https://cards.test/weird-art.jpg' } },
      { name: 'No Back Art', mana_cost: '', type_line: 'Creature' },
    ],
    prices: { eur: '0.10' }, legalities: { commander: 'legal' },
  },
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

async function seedDeck(page, ids) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async ({ id, ids }) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    for (const [cid, qty] of ids) deck = window.SN_DECKS.addCard(deck, cid, { qty }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, { id: deckId, ids });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  return deckId;
}

test('verify #373: edge cases + screenshot', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page, [['c-delver', 1], ['c-bolt', 1], ['c-weird', 1]]);

  // Edge 1: carta con 2 facce ma senza immagine sul retro → NIENTE tasto gira,
  // e cliccare sull'immagine non deve fare nulla (no-op).
  await page.locator('#deckList .dk-row', { hasText: 'Weird Two' }).hover();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/weird-front.jpg');
  await expect(page.locator('#previewFlip')).toBeHidden();
  await page.click('#previewImg');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/weird-front.jpg');

  // Edge 2: doppio click rapido sul tasto → torna al fronte (numero pari di flip).
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#previewFlip')).toBeVisible();
  await page.click('#previewFlip');
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');

  // Edge 3a (SLOW, invariante "cambio carta"): gira su retro, poi passa a un'ALTRA
  // carta lasciando che la preview dipinga davvero, poi TORNA → deve ripartire dal fronte.
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-back.jpg');
  await page.locator('#deckList .dk-row', { hasText: 'Lightning Bolt' }).hover();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg'); // Bolt DAVVERO dipinta
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');

  // Edge 3b (STESSA carta, preview chiusa e riaperta): gira su retro, muovi il
  // mouse fuori dalla lista finché la preview si chiude (torna alle statistiche),
  // poi ri-hover la STESSA riga → cosa mostra?
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-back.jpg');
  await page.mouse.move(5, 5);
  await expect(page.locator('#stateStats')).toBeVisible({ timeout: 4000 }); // preview chiusa
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/flip-373-revisit.png' });
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');
});
