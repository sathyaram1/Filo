// AUDIT (prober): l'import del deck builder non riconosce le intestazioni di
// sezione con il conteggio fra parentesi — il formato tipico di Archidekt/
// TappedOut, es. "Commander (1)", "Deck (99)", "Maybeboard (2)". Conseguenze
// per l'utente che incolla una lista copiata da quei siti:
//   1) il comandante NON viene riconosciuto (finisce fra le carte del mazzo,
//      il mazzo resta senza commander);
//   2) le carte del "Maybeboard"/"Sideboard" FINISCONO nel mazzo (l'intestazione
//      non viene vista come "sezione da saltare");
//   3) le righe di intestazione compaiono come "righe non riconosciute".
//
// Riproduzione dal cammino UI reale (import dialog → DECKS_IMPORT_PREVIEW →
// parseDecklist), Scryfall mockato. Si ASSERISCE il sintomo che l'utente vede:
// nessun "Commander riconosciuto" e la carta del maybeboard risolta come deck.

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const mk = (id, name, type = 'Artifact') => ({
      id, name, mana_cost: '{1}', cmc: 1, type_line: type,
      colors: [], color_identity: [],
      image_uris: { normal: `https://cards.test/${id}.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const ATRAXA = mk('atraxa', 'Atraxa, Praetors\' Voice', 'Legendary Creature — Phyrexian Angel Horror');
    const SOL = mk('sol-ring', 'Sol Ring');
    const SIGNET = mk('arcane-signet', 'Arcane Signet');
    const MAYBE = mk('maybe-card', 'Some Maybe Card');
    const BY_NAME = {
      'atraxa, praetors\' voice': ATRAXA,
      'sol ring': SOL,
      'arcane signet': SIGNET,
      'some maybe card': MAYBE,
    };
    const BY_ID = { atraxa: ATRAXA, 'sol-ring': SOL, 'arcane-signet': SIGNET, 'maybe-card': MAYBE };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/named') {
        body = BY_NAME[String(u.searchParams.get('fuzzy') || '').toLowerCase()] || null;
      } else if (BY_ID[u.pathname.replace('/cards/', '')]) {
        body = BY_ID[u.pathname.replace('/cards/', '')];
      } else if (u.pathname === '/symbology') {
        body = { data: [{ symbol: '{1}', svg_uri: 'https://svgs.test/1.svg' }] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Formato tipico di Archidekt "Export → Text" con categorie: ogni sezione ha
// un titolo con il numero di carte fra parentesi.
const ARCHIDEKT = `Commander (1)
1 Atraxa, Praetors' Voice

Deck (2)
1 Sol Ring
1 Arcane Signet

Maybeboard (1)
1 Some Maybe Card`;

test('import: intestazioni con conteggio (Archidekt) rompono commander e sezioni', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();

  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Importa…' }).click();
  await expect(page.locator('.dk-io-box')).toBeVisible();

  await page.fill('.dk-io-textarea', ARCHIDEKT);
  await page.locator('[data-io="parse"]').click();

  // Attende il rendering dell'anteprima.
  await expect(page.locator('.dk-io-note').first()).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/audit-decks-import-header-count.png' });

  const noteText = await page.locator('.dk-io-box').innerText();
  console.log('--- ANTEPRIMA IMPORT ---\n' + noteText + '\n------------------------');

  // SINTOMO 1: il comandante NON è riconosciuto → nessuna nota "Commander riconosciuto".
  await expect(page.locator('.dk-io-box')).not.toContainText('Commander riconosciuto');

  // SINTOMO 3: le intestazioni con conteggio finiscono fra le righe "non riconosciute".
  await expect(page.locator('.dk-io-dirty')).toContainText('Commander (1)');
  await expect(page.locator('.dk-io-dirty')).toContainText('Maybeboard (1)');

  // SINTOMO 1+2: vengono "riconosciute" 4 carte (Atraxa + Sol Ring + Arcane
  // Signet + la carta del Maybeboard), cioè il comandante e il maybeboard sono
  // stati trattati come normali carte da mazzo. In un parser corretto sarebbero
  // 2 (solo Sol Ring + Arcane Signet), con Atraxa come commander e il maybeboard saltato.
  await expect(page.locator('.dk-io-note').first()).toContainText('4 carte riconosciute su 4');
});
