// Colonna mazzo del deck builder (task 4, §8): righe con simboli di mana,
// gruppi collassabili per tipo, cambio vista, tasto destro (rimuovi / sposta
// in gruppo / imposta come commander) e check di legalità (identity).
// Scryfall è mockato nel main: niente rete.

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

async function mockScryfall(app) {
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

// Crea un mazzo dalla UI e ci mette dentro le carte via IPC (la ricerca arriva
// col task 5); poi ricarica il builder per vedere l'elenco.
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
  // location.reload(): il goto sullo stesso URL (cambia solo l'hash già
  // uguale) NON ricaricherebbe il documento e la pagina resterebbe stale.
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dk-row')).toHaveCount(3);
  return deckId;
}

test('l\'elenco raggruppa per tipo, mostra i simboli di mana e collassa i gruppi', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Gruppi canonici in ordine: Creature, Istantanei, Terre.
  const heads = page.locator('.dk-group-head');
  await expect(heads).toHaveCount(3);
  await expect(heads.nth(0)).toContainText('Creature');
  await expect(heads.nth(1)).toContainText('Istantanei');
  await expect(heads.nth(2)).toContainText('Terre');

  // La riga del drago ha i glifi {4}{R}{R} come <img> dalla symbology.
  const dragon = page.locator('.dk-row', { hasText: 'Shivan Dragon' });
  await expect(dragon.locator('img.dk-mana')).toHaveCount(3);
  await expect(dragon.locator('img.dk-mana').nth(0)).toHaveAttribute('src', 'https://svgs.test/4.svg');

  // Le basics mostrano la quantità (10×).
  await expect(page.locator('.dk-row', { hasText: 'Island' })).toContainText('10×');

  // Collassa "Terre": le sue righe scompaiono alla vista, le altre restano.
  const terreRows = page.locator('.dk-group[data-group="Terre"] .dk-group-rows');
  await page.locator('.dk-group-head', { hasText: 'Terre' }).click();
  await expect(terreRows).toBeHidden();
  await expect(page.locator('.dk-row:visible')).toHaveCount(2);
  await page.locator('.dk-group-head', { hasText: 'Terre' }).click();
  await expect(terreRows).toBeVisible();
  await expect(page.locator('.dk-row:visible')).toHaveCount(3);
});

// Il numero a destra dell'intestazione di ogni gruppo deve contare le COPIE
// (somma delle qty), non le righe distinte — coerente con la card Composizione
// e col totale in alto. Con 10× Island il gruppo "Terre" deve dire 10, non 1.
// Prima del fix questo assert era rosso (mostrava "1").
test('il numero del gruppo conta le copie, non le righe', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // 10× Island in "Terre" → l'intestazione conta 10 copie.
  await expect(page.locator('.dk-group[data-group="Terre"] .dk-group-n')).toHaveText('10');
  // Gruppi con una sola copia restano a 1.
  await expect(page.locator('.dk-group[data-group="Istantanei"] .dk-group-n')).toHaveText('1');
  await expect(page.locator('.dk-group[data-group="Creature"] .dk-group-n')).toHaveText('1');

  // Coerenza con la card Composizione delle statistiche: "Terre" dice 10 lì e 10 qui.
  await expect(page.locator('#statTypes .dk-type-row', { hasText: 'Terre' })).toContainText('10');
});

test('cambio vista (per costo) e override di gruppo dal tasto destro', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Vista per costo di mana: gruppi 0 / 1 / 6.
  await page.click('#groupBy');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'per costo di mana' }).click();
  await expect(page.locator('.dk-group-head').nth(0)).toContainText('0');
  await expect(page.locator('#groupBy')).toContainText('per costo');

  // Torna per tipo e sposta Lightning Bolt in "Creature" (override).
  await page.click('#groupBy');
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'per tipo' }).click();
  await page.locator('.dk-row', { hasText: 'Lightning Bolt' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Sposta in gruppo' }).click();
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Creature' }).click();
  const creature = page.locator('.dk-group[data-group="Creature"] .dk-row');
  await expect(creature).toHaveCount(2);
  await expect(page.locator('.dk-group[data-group="Istantanei"]')).toHaveCount(0);
});

test('imposta come commander dal tasto destro: header, identity check e rimozione dalla lista', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Il drago diventa commander: esce dall'elenco, entra nell'header.
  await page.locator('.dk-row', { hasText: 'Shivan Dragon' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Imposta come commander' }).click();
  await expect(page.locator('#commanderLine')).toHaveText(/Shivan Dragon/);
  await expect(page.locator('.dk-row', { hasText: 'Shivan Dragon' })).toHaveCount(0);

  // Identity check (§8.4): le Island (identity U) sono fuori dai colori del
  // commander mono-R → compare l'avviso.
  await expect(page.locator('#deckLegality')).toBeVisible();
  await expect(page.locator('#deckLegality')).toContainText('Island');

  // Rimuovi le Island: l'avviso sparisce e il conteggio scende.
  await page.locator('.dk-row', { hasText: 'Island' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Rimuovi' }).click();
  await expect(page.locator('#deckLegality')).toBeHidden();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
});
