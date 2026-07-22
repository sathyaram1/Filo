// #344: trascinare una carta su una categoria del deck builder.
//
// In vista "per tag" ogni categoria È un tag: rilasciare una carta su un tag
// deve — quando "aggiungi" e "sostituisci" darebbero esiti diversi — chiedere
// con un popup se aggiungere il tag a quelli già presenti o sostituirli tutti;
// quando non c'è ambiguità (la carta non ha tag, oppure ha già solo quel tag)
// deve agire senza popup. "Senza tag" toglie tutti i tag. Nelle altre viste il
// trascinamento forza il gruppo (come "Sposta in gruppo…").
//
// Il drag-and-drop HTML5 nativo non si attiva in modo affidabile dai movimenti
// del mouse simulati: si dispatcha la sequenza dragstart→dragover→drop con un
// DataTransfer condiviso (è ciò che riceve la pagina anche da un utente reale).
//
// Gli assert guardano il DATO scritto sul mazzo (i tag della carta) e la
// comparsa/assenza del popup: falliscono se la feature non fa la cosa giusta.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
  'c-solring': {
    id: 'c-solring', name: 'Sol Ring', mana_cost: '{1}', cmc: 1,
    type_line: 'Artifact', colors: [], color_identity: [],
    image_uris: { normal: 'https://cards.test/solring.jpg', art_crop: 'https://cards.test/solring-art.jpg' },
    prices: {}, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/solring',
  },
  'c-island': {
    id: 'c-island', name: 'Island', mana_cost: '', cmc: 0,
    type_line: 'Basic Land — Island', colors: [], color_identity: ['U'],
    image_uris: { normal: 'https://cards.test/island.jpg', art_crop: 'https://cards.test/island-art.jpg' },
    prices: {}, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/island',
  },
  'c-goblin': {
    id: 'c-goblin', name: 'Goblin Guide', mana_cost: '{R}', cmc: 1,
    type_line: 'Creature — Goblin Scout', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/goblin.jpg', art_crop: 'https://cards.test/goblin-art.jpg' },
    prices: {}, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/goblin',
  },
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const C = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      if (m && C[m[1]]) body = C[m[1]];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

// Dispatcha una vera sequenza di drag-and-drop dalla riga carta al gruppo.
async function dragCardOnto(page, cardId, groupName) {
  await page.evaluate(({ card, group }) => {
    const row = document.querySelector(`.dk-row[data-card-id="${card}"]`);
    const grp = [...document.querySelectorAll('.dk-group')].find((el) => el.dataset.group === group);
    const dt = new DataTransfer();
    const opt = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 40, clientY: 40 };
    row.dispatchEvent(new DragEvent('dragstart', opt));
    const target = grp.querySelector('.dk-group-head') || grp;
    target.dispatchEvent(new DragEvent('dragover', opt));
    target.dispatchEvent(new DragEvent('drop', opt));
    row.dispatchEvent(new DragEvent('dragend', opt));
  }, { card: cardId, group: groupName });
}

async function tagsOf(page, deckId, cardId) {
  return page.evaluate(async ({ id, card }) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const e = r.deck.carte.find((c) => c.scryfall_id === card);
    return e ? e.tags : null;
  }, { id: deckId, card: cardId });
}

async function seedTagDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    // Ordine dei tag = prima apparizione: ramp, terre.
    deck.carte = [
      { scryfall_id: 'c-solring', qty: 1, tags: ['ramp'] },
      { scryfall_id: 'c-island', qty: 10, tags: ['terre'] },
      { scryfall_id: 'c-goblin', qty: 1, tags: [] },
    ];
    deck.raggruppamento = 'tag';
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dk-group[data-group="ramp"] .dk-row')).toHaveCount(1);
  return deckId;
}

test('vista tag, ambiguità reale → popup aggiungi/sostituisci; "sostituisci" rimpiazza i tag', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedTagDeck(page);

  // Sol Ring ha già il tag "ramp" e viene rilasciata su "terre": add e replace
  // divergono → deve comparire il popup con ENTRAMBE le opzioni.
  await dragCardOnto(page, 'c-solring', 'terre');
  await expect(page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Aggiungi tag' })).toHaveCount(1);
  await expect(page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Sostituisci con' })).toHaveCount(1);

  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Sostituisci con' }).click();
  await expect.poll(() => tagsOf(page, deckId, 'c-solring')).toEqual(['terre']);
});

test('vista tag, "aggiungi" accoda il tag senza toccare gli altri', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedTagDeck(page);

  await dragCardOnto(page, 'c-solring', 'terre');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Aggiungi tag' }).click();
  await expect.poll(() => tagsOf(page, deckId, 'c-solring')).toEqual(['ramp', 'terre']);
});

test('vista tag, carta senza tag → nessun popup, il tag si aggiunge subito', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedTagDeck(page);

  // Goblin Guide non ha tag: aggiungi e sostituisci coincidono → niente popup.
  await dragCardOnto(page, 'c-goblin', 'ramp');
  await expect.poll(() => tagsOf(page, deckId, 'c-goblin')).toEqual(['ramp']);
  await expect(page.locator('.dk-ctxmenu')).toHaveCount(0);
});

test('vista tag, rilascio su "Senza tag" rimuove tutti i tag', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedTagDeck(page);

  await dragCardOnto(page, 'c-solring', 'Senza tag');
  await expect.poll(() => tagsOf(page, deckId, 'c-solring')).toEqual([]);
  await expect(page.locator('.dk-ctxmenu')).toHaveCount(0);
});

test('vista per tipo, trascinare forza il gruppo (parità con "Sposta in gruppo")', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await seedTagDeck(page);

  // Passa alla vista per tipo: gruppi Artefatti / Terre / Creature.
  await page.click('#groupBy');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'per tipo' }).click();
  await expect(page.locator('#groupBy')).toContainText('per tipo');
  await expect(page.locator('.dk-group[data-group="Artefatti"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(1);

  // Trascina Sol Ring dagli Artefatti alle Terre: nessun popup (non è vista tag),
  // l'override forza il gruppo e i tag NON cambiano.
  await dragCardOnto(page, 'c-solring', 'Terre');
  await expect(page.locator('.dk-ctxmenu')).toHaveCount(0);
  await expect(page.locator('.dk-group[data-group="Terre"] .dk-row', { hasText: 'Sol Ring' })).toHaveCount(1);
  await expect.poll(() => tagsOf(page, deckId, 'c-solring')).toEqual(['ramp']);
});
