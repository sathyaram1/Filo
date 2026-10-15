// Libreria dei mazzi (DECK-BUILDER-SPEC.md §10, feedback #790): ogni scheda mostra il prezzo totale del mazzo, dalla
// cache subito e coi prezzi freschi dopo; il tasto destro ha Duplica, Esporta… (lo stesso testo dell'export del banco
// di lavoro), Rinomina… ed Elimina…, con l'animazione al passaggio come gli altri menu.

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
    type_line: 'Creature — Dragon', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/dragon.jpg', art_crop: 'https://cards.test/dragon-art.jpg' },
    prices: { eur: '0.90' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/dragon',
  },
  'c-sol': {
    id: 'c-sol', name: 'Sol Ring', mana_cost: '{1}', cmc: 1,
    type_line: 'Artifact', colors: [], color_identity: [],
    image_uris: { normal: 'https://cards.test/sol.jpg', art_crop: 'https://cards.test/sol-art.jpg' },
    prices: { eur: '2.00' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/sol',
  },
  'c-island': {
    id: 'c-island', name: 'Island', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Island', colors: [], color_identity: ['U'],
    image_uris: { normal: 'https://cards.test/island.jpg', art_crop: 'https://cards.test/island-art.jpg' },
    prices: {}, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/island',
  },
};

const DECKS = [
  { nome: 'Fulmini', carte: [['c-bolt', 1], ['c-dragon', 1]] },            // 1,50 + 0,90
  { nome: 'Artefatti', carte: [['c-sol', 1], ['c-bolt', 1]] },             // 2,00 + 1,50
  { nome: 'Isole', carte: [['c-bolt', 1], ['c-island', 10]] },             // 1,50 + 10 senza prezzo
];

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

// Mazzi salvati e carte in cache, come dopo averli costruiti nel banco di lavoro.
async function seedLibrary(app, page) {
  await mockScryfall(app);
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
    await chrome.runtime.sendMessage({ type: MSG.SCRYFALL_CARDS, ids: ['c-bolt', 'c-dragon', 'c-sol', 'c-island'] });
    return out;
  }, DECKS);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckGrid [data-deck-id]')).toHaveCount(DECKS.length);
  return ids;
}

const scheda = (page, nome) => page.locator('#deckGrid [data-deck-id]', { hasText: nome });
const prezzo = (page, nome) => scheda(page, nome).locator('.dk-price');

test('ogni scheda della libreria mostra il prezzo totale del suo mazzo; con prezzi mancanti si vede che è parziale', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedLibrary(app, page);

  await expect(prezzo(page, 'Fulmini')).toHaveText('2,40 €');
  await expect(prezzo(page, 'Artefatti')).toHaveText('3,50 €');
  await expect(prezzo(page, 'Isole')).toHaveText('≥ 1,50 €');
  await expect(prezzo(page, 'Isole')).toHaveAttribute('title', /10 carte senza prezzo noto/);

  // Lo stesso totale del pannello statistiche del banco di lavoro.
  await scheda(page, 'Artefatti').click();
  await expect(page.locator('#statBudget [data-b="total"] .dk-budget-n')).toHaveText('3,50 €');
  await page.click('#backToLibrary');
  await expect(prezzo(page, 'Artefatti')).toHaveText('3,50 €');

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.locator('#screenLibrary').screenshot({ path: `tests/.shots/decks-library-prezzi-${tema}.png` }).catch(() => {});
  }
});

test('la libreria compare coi prezzi della cache e li aggiorna quando arrivano quelli freschi', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedLibrary(app, page);

  // Prezzi in cache stantii (più di 6 ore) e Scryfall che risponde solo quando il test lo lascia andare, col Bolt rincarato.
  await app.evaluate(async (electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    const KEY = globalThis.SN_CONST.STORAGE_KEYS.SCRYFALL_CARDS;
    const map = (await chrome.storage.local.get(KEY))[KEY] || {};
    for (const id of Object.keys(map)) map[id].fetchedAt = Date.now() - 7 * 60 * 60 * 1000;
    await chrome.storage.local.set({ [KEY]: map });
    globalThis.__prezziFreschi = new Promise((r) => { globalThis.__rilascia = r; });
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const m = /^\/cards\/([^/]+)$/.exec(new URL(String(url)).pathname);
      if (!m || !CARDS[m[1]]) return { ok: false, status: 404, json: async () => ({}) };
      await globalThis.__prezziFreschi;
      const body = m[1] === 'c-bolt' ? { ...CARDS[m[1]], prices: { eur: '3.00' } } : CARDS[m[1]];
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));

  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckGrid [data-deck-id]')).toHaveCount(DECKS.length, { timeout: 4000 });
  await expect(prezzo(page, 'Fulmini')).toHaveText('2,40 €', { timeout: 4000 });
  await expect(prezzo(page, 'Isole')).toHaveText('≥ 1,50 €');

  await app.evaluate(() => globalThis.__rilascia());
  await expect(prezzo(page, 'Fulmini')).toHaveText('3,90 €');
  await expect(prezzo(page, 'Artefatti')).toHaveText('5,00 €');
  await expect(prezzo(page, 'Isole')).toHaveText('≥ 3,00 €');
});

test('Esporta… dal tasto destro sulla scheda dà lo stesso testo dell\'export dal banco di lavoro', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedLibrary(app, page);

  await scheda(page, 'Fulmini').click({ button: 'right' });
  await expect(page.locator('.dk-ctxmenu .sn-select-option')).toHaveText(['Duplica', 'Esporta…', 'Rinomina…', 'Elimina…']);
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Esporta…' }).click();
  const ta = page.locator('.dk-io-overlay .dk-io-textarea');
  await expect(ta).toHaveValue(/1 Lightning Bolt/);
  const dallaLibreria = await ta.inputValue();
  expect(dallaLibreria).toContain('1 Shivan Dragon');
  await page.locator('.dk-io-overlay [data-io="close"]').click();
  await expect(page.locator('.dk-io-overlay')).toHaveCount(0);
  await expect(page.locator('#screenLibrary')).toBeVisible();

  await scheda(page, 'Fulmini').click();
  await expect(page.locator('#deckNameText')).toHaveText('Fulmini');
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Esporta…' }).click();
  await expect(ta).toHaveValue(/1 Lightning Bolt/);
  expect(await ta.inputValue()).toBe(dallaLibreria);
});

test('Rinomina… dal tasto destro: il nome nuovo compare sulla scheda, al suo posto, e nel banco di lavoro', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedLibrary(app, page);
  const cards = page.locator('#deckGrid [data-deck-id]');
  const ordine = await cards.locator('.sn-card-title').allTextContents();
  const pos = ordine.indexOf('Artefatti');

  // Esc annulla, un nome vuoto lascia quello di prima.
  await scheda(page, 'Artefatti').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  const campo = page.locator('#deckGrid .dk-card-rename');
  await expect(campo).toBeFocused();
  await expect(campo).toHaveValue('Artefatti');
  await campo.fill('Da buttare');
  await campo.press('Escape');
  await expect(campo).toHaveCount(0);
  await expect(cards.nth(pos).locator('.sn-card-title')).toHaveText('Artefatti');

  await scheda(page, 'Artefatti').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  await campo.fill('   ');
  await campo.press('Enter');
  await expect(campo).toHaveCount(0);
  await expect(cards.nth(pos).locator('.sn-card-title')).toHaveText('Artefatti');

  // Clic, spazio e Invio dentro il campo restano al campo: la scheda non apre il mazzo.
  await scheda(page, 'Artefatti').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  await campo.fill('Goblin');
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.locator('#screenLibrary').screenshot({ path: `tests/.shots/decks-library-rinomina-${tema}.png` }).catch(() => {});
  }
  await campo.click();
  await campo.press('End');
  await campo.pressSequentially(' <b>rossi</b> 🔥');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await campo.press('Enter');
  await expect(campo).toHaveCount(0);
  await expect(page.locator('#screenLibrary')).toBeVisible();

  const nome = 'Goblin <b>rossi</b> 🔥';
  await expect(cards.nth(pos).locator('.sn-card-title')).toHaveText(nome);
  await expect(cards.nth(pos).locator('.sn-card-title b')).toHaveCount(0);
  await expect(cards.nth(pos)).toBeFocused();
  await expect(cards.nth(pos).locator('.dk-price')).toHaveText('3,50 €');

  await cards.nth(pos).click();
  await expect(page.locator('#deckNameText')).toHaveText(nome);
  await page.click('#backToLibrary');
  await expect(scheda(page, nome)).toHaveCount(1);
});

test('una rinomina lasciata a metà si salva prima che il banco di lavoro rilegga il mazzo', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const ids = await seedLibrary(app, page);

  await scheda(page, 'Fulmini').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' }).click();
  await page.locator('#deckGrid .dk-card-rename').fill('Burn');
  // Con il campo ancora aperto si va al mazzo da un'altra strada (link, cronologia).
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, ids.Fulmini);
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await expect(page.locator('#deckNameText')).toHaveText('Burn');
});

test('le voci del menu della scheda si accendono al passaggio del mouse', async ({ app, openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedLibrary(app, page);

  await scheda(page, 'Fulmini').click({ button: 'right' });
  const voce = page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rinomina…' });
  const fondo = () => voce.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await voce.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('background-color');
  await page.mouse.move(0, 0);
  const prima = await fondo();
  await voce.hover();
  await expect.poll(fondo).not.toBe(prima);
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.screenshot({ path: `tests/.shots/decks-library-menu-${tema}.png` }).catch(() => {});
  }
});
