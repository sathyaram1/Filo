// Audit (prober): "Sposta in gruppo" nel deck builder attraversa le viste.
// Sospetto dalla lettura del codice: l'override di gruppo (tasto destro →
// "Sposta in gruppo…") è salvato sul mazzo SENZA memoria della vista in cui è
// stato fatto, e groupOf() lo applica PRIMA di guardare il raggruppamento
// corrente. Risultato atteso dal sospetto: sposto Sol Ring nel gruppo "Terre"
// nella vista per tipo, poi passo alla vista "per costo di mana" e Sol Ring
// NON sta nella colonna del suo costo (1) ma in un gruppo alieno "Terre"
// infilato tra i bucket numerici.
//
// Questo spec riproduce il flusso da utente e ASSERISCE il comportamento
// corretto (l'override vale nella vista dove l'ho fatto, le altre viste
// raggruppano secondo il loro criterio). Se il bug c'è, l'assert è rosso.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-solring': {
    id: 'c-solring', name: 'Sol Ring', mana_cost: '{1}', cmc: 1,
    type_line: 'Artifact', colors: [], color_identity: [],
    image_uris: { normal: 'https://cards.test/solring.jpg', art_crop: 'https://cards.test/solring-art.jpg' },
    prices: {}, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/solring',
  },
  'c-island': {
    id: 'c-island', name: 'Island', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Island', colors: [], color_identity: ['U'],
    image_uris: { normal: 'https://cards.test/island.jpg', art_crop: 'https://cards.test/island-art.jpg' },
    prices: {}, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/island',
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
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

// Fix #316: l'override di gruppo è ora PER-VISTA — "Terre" fatto nella vista per
// tipo vale solo lì; passando a "per costo di mana" Sol Ring torna nel bucket
// del suo costo (1). Questo assert era ROSSO prima del fix (Sol Ring compariva
// in un gruppo alieno "Terre" tra i bucket 0-7+), ora è VERDE.
test('l\'override di gruppo non inquina le altre viste (per costo di mana)', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // Mazzo con Sol Ring (Artefatti) e Island (Terre), creato dalla UI.
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = window.SN_DECKS.addCard(r.deck, 'c-solring', { qty: 1 }).deck;
    deck = window.SN_DECKS.addCard(deck, 'c-island', { qty: 10 }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');

  // Vista per tipo: Sol Ring sta in "Artefatti", Island in "Terre".
  await expect(page.locator('.dk-group[data-group="Artefatti"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(1);
  await expect(page.locator('.dk-group[data-group="Terre"] .dk-row', { hasText: 'Island' })).toHaveCount(1);

  // Flusso utente: tasto destro su Sol Ring → Sposta in gruppo… → Terre.
  await page.locator('.dk-row', { hasText: 'Sol Ring' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Sposta in gruppo' }).click();
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Terre' }).click();
  await expect(page.locator('.dk-group[data-group="Terre"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(1);

  // Cambio vista: per costo di mana.
  await page.click('#groupBy');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'per costo di mana' }).click();
  await expect(page.locator('#groupBy')).toContainText('per costo');

  await page.screenshot({ path: 'tests/.shots/audit-decks-override-cmc-view.png' });

  // ASSERZIONE CHIAVE: nella vista per CMC, Sol Ring deve stare nel bucket
  // del suo costo ("1"), non in un gruppo alieno "Terre" ereditato dalla
  // vista per tipo.
  await expect(page.locator('.dk-group[data-group="1"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(1);
  await expect(page.locator('.dk-group[data-group="Terre"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(0);
});
