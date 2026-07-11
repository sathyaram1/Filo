// Import/Export testuale del deck builder (task 9, DECK-BUILDER-SPEC.md §11),
// via switcher (§8.2): "Importa…" incolla una lista, il parser RIGIDO risolve
// ogni nome su Scryfall (mockato) e mostra un'anteprima di conferma PRIMA di
// scrivere nel mazzo — mai un'importazione "a scatola chiusa". "Esporta…"
// genera lo stesso formato testuale, pronto da copiare. Si asserisce il
// SUCCESSO: le carte compaiono davvero nella colonna del mazzo con la qty
// giusta, non solo che l'overlay "non dà errore".

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const SOL_RING = {
      id: 'sol-ring', name: 'Sol Ring', mana_cost: '{1}', cmc: 1,
      type_line: 'Artifact', colors: [], color_identity: [],
      image_uris: { normal: 'https://cards.test/sol.jpg' },
      prices: { eur: '1.50' }, legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/sol',
    };
    const FOREST = {
      id: 'forest', name: 'Forest', mana_cost: '', cmc: 0,
      type_line: 'Basic Land — Forest', colors: [], color_identity: ['G'],
      produced_mana: ['G'],
      image_uris: { normal: 'https://cards.test/forest.jpg' },
      prices: { eur: '0.10' }, legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/forest',
    };
    const ATRAXA = {
      id: 'atraxa', name: "Atraxa, Praetors' Voice", mana_cost: '{G}{W}{U}{B}', cmc: 4,
      type_line: 'Legendary Creature — Phyrexian Angel',
      colors: ['G', 'W', 'U', 'B'], color_identity: ['G', 'W', 'U', 'B'],
      image_uris: { normal: 'https://cards.test/atraxa.jpg', art_crop: 'https://cards.test/atraxa-art.jpg' },
      prices: { eur: '18.00' }, legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/atraxa',
    };
    const BY_NAME = { 'sol ring': SOL_RING, forest: FOREST, "atraxa, praetors' voice": ATRAXA };
    const BY_ID = { 'sol-ring': SOL_RING, forest: FOREST, atraxa: ATRAXA };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/named') {
        const fuzzy = String(u.searchParams.get('fuzzy') || '').toLowerCase();
        body = BY_NAME[fuzzy] || null;
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

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

// Provider LLM finto per l'import via chat (§11.2): qualunque messaggio viene
// "interpretato" come la stessa lista incollata — nomi + quantità + commander.
// La risoluzione su Scryfall resta compito del SISTEMA (mock sopra), mai del
// modello: qui non compare nessun id.
async function mockImportProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({
        reply: 'Ho letto la tua lista.',
        import: [{ name: 'Sol Ring', qty: 1 }, { name: 'Forest', qty: 10 }],
        commander: "Atraxa, Praetors' Voice",
      }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  });
}

test('Importa dallo switcher: anteprima segnala non-trovati/sporchi, la conferma scrive le carte nel mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Importa…' }).click();
  await expect(page.locator('.dk-io-box')).toBeVisible();

  await page.fill('.dk-io-textarea', '1 Sol Ring\n10 Forest\n1 Carta Che Non Esiste\nriga senza quantità');
  await page.locator('[data-io="parse"]').click();

  // Il parser rigido riconosce 3 righe ben formate ("1 Sol Ring", "10 Forest",
  // "1 Carta Che Non Esiste": ha qty+nome, è sintatticamente valida) su 4; di
  // quelle 3, solo 2 si risolvono davvero su Scryfall. La riga senza quantità
  // è sporca fin dal parsing. Le due segnalazioni restano DISTINTE:
  // "non trovata" ≠ "riga illeggibile", non si mescolano nel messaggio.
  await expect(page.locator('.dk-io-note').first()).toContainText('2 carte riconosciute su 3');
  await expect(page.locator('.dk-io-dirty li')).toHaveCount(2); // "Carta Che Non Esiste" (non risolta) + la riga sporca
  await expect(page.locator('.dk-io-dirty')).toContainText('riga senza quantità');
  await expect(page.locator('.dk-io-dirty')).toContainText('Carta Che Non Esiste');

  const applyBtn = page.locator('[data-io="apply"]');
  await expect(applyBtn).toHaveText('Importa 2 carte');
  await applyBtn.click();

  // L'overlay si chiude e le carte compaiono DAVVERO nella colonna centrale,
  // con la quantità giusta per le basic land (§11.1).
  await expect(page.locator('.dk-io-box')).toHaveCount(0);
  await expect(page.locator('#deckList .dk-row[data-card-id="sol-ring"]')).toBeVisible();
  await expect(page.locator('#deckList .dk-row[data-card-id="forest"]')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('11/100 carte');
});

test('Esporta dallo switcher: stesso formato testuale, con la carta e la quantità reali', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  // Importa prima due carte così l'export ha qualcosa da mostrare.
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Importa…' }).click();
  await page.fill('.dk-io-textarea', '1 Sol Ring\n10 Forest');
  await page.locator('[data-io="parse"]').click();
  await page.locator('[data-io="apply"]').click();
  await expect(page.locator('.dk-io-box')).toHaveCount(0);

  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Esporta…' }).click();
  const ta = page.locator('.dk-io-textarea');
  await expect(ta).toHaveValue('Deck\n10 Forest\n1 Sol Ring');
});

test('Import via chat: il click sul candidato commander lo imposta come commander, non come carta normale', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockImportProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeck(page);

  // Lista grezza incollata in chat → bolla di conferma con le carte risolte
  // (commander in testa) e il bottone "Aggiungi tutte" (§11.2). Niente viene
  // scritto nel mazzo finché l'utente non conferma.
  await page.fill('#chatInput', "1 sol ring\n10 foresta\natraxa voce dei pretori");
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(3);
  await expect(bubble.locator('.dk-import-all')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');

  // FIX (#289.9): il toggle sulla riga del commander candidato lo IMPOSTA come
  // commander del mazzo (parametro, §8.4) — prima lo aggiungeva come carta
  // normale e il mazzo restava senza commander.
  await bubble.locator('[data-add="atraxa"]').click();
  await expect(page.locator('#commanderLine')).toContainText("Commander: Atraxa, Praetors' Voice");
  await expect(page.locator('#deckList .dk-row[data-card-id="atraxa"]')).toHaveCount(0);
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');
  // La riga ora mostra lo stato "già nel mazzo" (il commander nel mazzo c'è).
  const cmdToggle = page.locator('.dk-msg-bot').last().locator('[data-add="atraxa"]');
  await expect(cmdToggle).toHaveAttribute('data-in', '1');

  // Un secondo click NON deve degenerare in "aggiungi come carta normale":
  // il commander non si duplica e non si rimuove da qui.
  await cmdToggle.click();
  await expect(page.locator('#deckList .dk-row[data-card-id="atraxa"]')).toHaveCount(0);
  await expect(page.locator('#commanderLine')).toContainText('Commander: Atraxa');
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');

  // Le righe non-commander continuano a comportarsi da toggle normale.
  await page.locator('.dk-msg-bot').last().locator('[data-add="sol-ring"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="sol-ring"]')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');

  // "Aggiungi tutte" completa l'import (qty reali, commander già impostato
  // resta quello): 1 Sol Ring (già dentro) + 10 Forest.
  await page.locator('.dk-msg-bot').last().locator('.dk-import-all').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="forest"]')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('11/100 carte');
});
