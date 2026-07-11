// Audit (prober): "Sposta in un altro mazzo" nel deck builder.
// Sospetto dalla lettura del codice: se il mazzo di destinazione contiene GIÀ
// la carta, l'aggiunta è un no-op (added:false, qty non aggiornata) ma la
// rimozione dal mazzo di origine avviene comunque → le copie extra spariscono
// (es. 10 Island → 1 Island totale). Questo spec riproduce il flusso da utente
// (tasto destro → Sposta in un altro mazzo → scelta del mazzo) e ASSERISCE che
// il totale delle copie si conservi.

import { test, expect } from './fixtures/electron.mjs';

const CARDS = {
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

// test.fixme: repro del bug (oggi ROSSO — verificato: 10 Island + 1 Island
// diventano 1 Island totale dopo il move). Documenta il comportamento atteso
// senza tenere rossa la suite. Chi lavorerà il feedback toglie `.fixme` per
// farlo diventare un assert vivo (deve passare col fix).
test.fixme('spostare una carta in un mazzo che la contiene già non perde le copie', async ({ app, openTab }) => {
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');

  // Mazzo di DESTINAZIONE via IPC: "Mazzo B" con 1 Island.
  await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_CREATE, nome: 'Mazzo B' });
    let deck = window.SN_DECKS.addCard(r.deck, 'c-island', { qty: 1 }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  });

  // Mazzo di ORIGINE dalla UI: "Nuovo mazzo" con 10 Island.
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const sourceId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = window.SN_DECKS.addCard(r.deck, 'c-island', { qty: 10 }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, sourceId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dk-row', { hasText: 'Island' })).toContainText('10×');

  // Flusso utente: tasto destro sulla riga → Sposta in un altro mazzo → Mazzo B.
  await page.locator('.dk-row', { hasText: 'Island' }).click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Sposta in un altro mazzo' }).click();
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Mazzo B' }).click();

  // La riga esce dal mazzo di origine (il "move" è avvenuto).
  await expect(page.locator('.dk-row', { hasText: 'Island' })).toHaveCount(0);

  // ASSERZIONE CHIAVE: le 10 copie spostate devono esistere da qualche parte.
  // Somma delle Island su TUTTI i mazzi: prima del move erano 10+1=11; dopo un
  // move corretto devono restarne ALMENO 10 (le copie spostate). Se il bug
  // c'è, ne resta 1 sola (le altre 9/10 sono sparite).
  const totals = await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_LIST });
    const out = {};
    for (const d of r.decks) {
      const entry = (d.carte || []).find((c) => c.scryfall_id === 'c-island');
      out[d.nome] = entry ? entry.qty : 0;
    }
    return out;
  });
  const totalCopies = Object.values(totals).reduce((a, b) => a + b, 0);
  expect(totalCopies, `copie totali di Island dopo il move: ${JSON.stringify(totals)}`)
    .toBeGreaterThanOrEqual(10);
});
