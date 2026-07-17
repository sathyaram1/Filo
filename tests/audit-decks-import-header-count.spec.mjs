// Regressione (da audit/prober, poi fix): l'import del deck builder deve
// riconoscere le intestazioni di sezione con il conteggio fra parentesi — il
// formato tipico di Archidekt/TappedOut, es. "Commander (1)", "Deck (99)",
// "Maybeboard (2)". Comportamento atteso per l'utente che incolla una lista
// copiata da quei siti:
//   1) il comandante VIENE riconosciuto come tale;
//   2) le carte del "Maybeboard"/"Sideboard" restano FUORI dal mazzo;
//   3) le righe di intestazione NON compaiono fra le "righe non riconosciute".
//
// Esercita il cammino UI reale (import dialog → DECKS_IMPORT_PREVIEW →
// parseDecklist), Scryfall mockato. Prima del fix questo spec era il prober
// che ASSERIVA i sintomi; ora asserisce il successo (fallirebbe senza fix).

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

// Formato tipico di Archidekt "Export → Text": ogni sezione ha un titolo con il
// numero di carte fra parentesi. La riga vuota extra dentro il Maybeboard copre
// anche il caso collaterale (non deve far rientrare la carta nel mazzo).
const ARCHIDEKT = `Commander (1)
1 Atraxa, Praetors' Voice

Deck (2)
1 Sol Ring
1 Arcane Signet

Maybeboard (1)

1 Some Maybe Card`;

test('import: intestazioni con conteggio (Archidekt) → commander e maybeboard gestiti', async ({ app, openTab }) => {
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

  // 1) Il comandante È riconosciuto come tale.
  await expect(page.locator('.dk-io-box')).toContainText('Commander riconosciuto: Atraxa, Praetors\' Voice');

  // 3) Le intestazioni con conteggio NON sono "righe non riconosciute".
  await expect(page.locator('.dk-io-dirty')).toHaveCount(0);

  // 1+2) Solo le 2 carte del mazzo vero (Sol Ring + Arcane Signet): il
  // comandante è a parte e il maybeboard è saltato — anche la carta dopo la
  // riga vuota dentro il Maybeboard.
  await expect(page.locator('.dk-io-box')).toContainText('2 carte riconosciute su 2');
  await expect(page.locator('.dk-io-box')).not.toContainText('Some Maybe Card');
});
