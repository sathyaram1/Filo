import { test, expect } from '../../fixtures/electron.mjs';

const CARDS = {
  'c-bolt': {
    id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
    type_line: 'Instant', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/bolt.jpg', art_crop: 'https://cards.test/bolt-art.jpg' },
    prices: { eur: '1.50' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/bolt',
  },
  'c-sol': {
    id: 'c-sol', name: 'Sol Ring', mana_cost: '{1}', cmc: 1,
    type_line: 'Artifact', colors: [], color_identity: [],
    image_uris: { normal: 'https://cards.test/sol.jpg', art_crop: 'https://cards.test/sol-art.jpg' },
    prices: { eur: '2.00' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/sol',
  },
};

async function seed(app, page, specs) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const m = /^\/cards\/([^/]+)$/.exec(new URL(String(url)).pathname);
      if (!m || !CARDS[m[1]]) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => CARDS[m[1]] };
    });
  }, JSON.stringify(CARDS));
  const ids = await page.evaluate(async (specs) => {
    const { MSG } = window.SN_MSG;
    const out = {};
    for (const s of specs) {
      const c = await chrome.runtime.sendMessage({ type: MSG.DECKS_CREATE, nome: s.nome });
      let deck = c.deck;
      for (const [cid, qty] of s.carte) deck = window.SN_DECKS.addCard(deck, cid, { qty }).deck;
      await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
      out[s.nome] = deck.id;
    }
    await chrome.runtime.sendMessage({ type: MSG.SCRYFALL_CARDS, ids: ['c-bolt', 'c-sol'] });
    return out;
  }, specs);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckGrid [data-deck-id]')).toHaveCount(specs.length);
  return ids;
}

const scheda = (page, nome) => page.locator('#deckGrid [data-deck-id]', { hasText: nome });

test('duplica, elimina, mazzo vuoto, nome lunghissimo, ritorno dal banco', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seed(app, page, [
    { nome: 'Alfa', carte: [['c-bolt', 2]] },
    { nome: 'Vuoto', carte: [] },
  ]);
  await expect(scheda(page, 'Alfa').locator('.dk-price')).toHaveText('3,00 €');
  console.log('VUOTO:', JSON.stringify(await scheda(page, 'Vuoto').locator('.dk-price').textContent()));

  await scheda(page, 'Alfa').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Duplica' }).click();
  await expect(page.locator('#deckGrid [data-deck-id]')).toHaveCount(3);
  const prezzi = await page.locator('#deckGrid .dk-price').allTextContents();
  console.log('DOPO DUPLICA:', JSON.stringify(prezzi));

  const lungo = 'Mazzo dal nome lunghissimo '.repeat(10).trim();
  await scheda(page, 'Vuoto').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  const larghezzaPrima = await page.locator('#deckGrid [data-deck-id]').first().evaluate((el) => el.getBoundingClientRect().width);
  await page.locator('#deckGrid .dk-card-rename').fill(lungo);
  await page.locator('#deckGrid .dk-card-rename').press('Enter');
  await expect(scheda(page, 'lunghissimo')).toHaveCount(1);
  const larghezze = await page.locator('#deckGrid [data-deck-id]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  console.log('LARGHEZZE:', larghezzaPrima, JSON.stringify(larghezze));
  const titolo = scheda(page, 'lunghissimo').locator('.sn-card-title');
  console.log('TITOLO overflow:', await titolo.evaluate((el) => [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight]));
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.locator('#screenLibrary').screenshot({ path: `tests/.shots/v790-lungo-${tema}.png` });
  }

  // Dal banco si aggiunge una carta, si torna: il prezzo segue.
  await scheda(page, 'Alfa').first().click();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const id = decodeURIComponent(location.hash.split('/').pop());
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = window.SN_DECKS.addCard(r.deck, 'c-sol', { qty: 1 }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  });
  await page.click('#backToLibrary');
  await page.waitForTimeout(800);
  console.log('DOPO BANCO:', JSON.stringify(await page.locator('#deckGrid [data-deck-id]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')))));

  // Elimina: le altre schede tengono il prezzo.
  await scheda(page, 'lunghissimo').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Elimina…' }).click();
  await page.locator('.sn-confirm-ok, button:has-text("Elimina")').last().click();
  await expect(page.locator('#deckGrid [data-deck-id]')).toHaveCount(2);
  console.log('DOPO ELIMINA:', JSON.stringify(await page.locator('#deckGrid .dk-price').allTextContents()));

  // Tasto destro da tastiera sulla scheda col fuoco.
  await page.locator('#deckGrid [data-deck-id]').first().focus();
  await page.keyboard.press('Shift+F10');
  await page.waitForTimeout(300);
  const menu = page.locator('.dk-ctxmenu');
  console.log('MENU TASTIERA:', await menu.count(), await menu.count() ? JSON.stringify(await menu.boundingBox()) : '');
  await page.screenshot({ path: 'tests/.shots/v790-menu-tastiera.png' });
});

test('due schede: rinomina in libreria e modifica nel banco aperto altrove', async ({ app, openTab }) => {
  const lib = await openTab('filo://decks/decks.html');
  await lib.waitForLoadState('domcontentloaded');
  const ids = await seed(app, lib, [{ nome: 'Beta', carte: [['c-bolt', 1]] }]);
  const banco = await openTab(`filo://decks/decks.html#/deck/${ids.Beta}`);
  await banco.waitForLoadState('domcontentloaded');
  await expect(banco.locator('#deckNameText')).toHaveText('Beta');

  await lib.bringToFront().catch(() => {});
  await scheda(lib, 'Beta').click({ button: 'right' });
  await lib.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  await lib.locator('#deckGrid .dk-card-rename').fill('Gamma');
  await lib.locator('#deckGrid .dk-card-rename').press('Enter');
  await expect(scheda(lib, 'Gamma')).toHaveCount(1);

  // Nel banco aperto prima si cambia il budget dal menu del mazzo: una modifica qualsiasi.
  await banco.evaluate(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  console.log('BANCO NOME dopo rinomina altrove:', await banco.locator('#deckNameText').textContent());
});
