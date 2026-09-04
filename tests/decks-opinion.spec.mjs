// Parere LLM + box modulare + auto-tag (task 8, DECK-BUILDER-SPEC.md §5.2, §6,
// §7). Provider LLM e Scryfall MOCKATI nel main (niente rete), messaggi sul
// cammino IPC reale. Si asserisce il SUCCESSO:
// - il box modulare si sceglie col tasto destro e il modulo "Parere di Filo"
//   mostra il giudizio contestuale della carta in hover;
// - dopo un edit del mazzo il parere resta visibile ma STANTIO (pallino +
//   "Aggiorna"), e il refresh on-demand lo rigenera (§6.2);
// - "valuta il mazzo" in chat prepara i pareri in batch + sintesi, e l'hover
//   successivo NON rifà chiamate LLM (cache per carta/versione);
// - "tagga il mazzo con removal" applica i tag alle carte giuste e il
//   giudizio (carta, tag) è riusato in un ALTRO mazzo senza nuove chiamate.

import { test, expect } from './fixtures/electron.mjs';

// Mini-API Scryfall finta (stesse carte di decks-chat.spec.mjs).
async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1',
      name: 'Niv-Mizzet, Parun',
      mana_cost: '{U}{U}{U}{R}{R}{R}',
      cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard',
      oracle_text: 'Whenever you draw a card, deal 1 damage to any target.',
      colors: ['U', 'R'],
      color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/niv',
    };
    const BOLT = {
      id: 'bolt-1',
      name: 'Lightning Bolt',
      mana_cost: '{R}',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/bolt.jpg' },
      prices: { eur: '1.10' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/bolt',
    };
    const CRASHER = {
      id: 'crasher-1',
      name: 'Embercleave Crasher',
      mana_cost: '{2}{R}{R}',
      cmc: 4,
      type_line: 'Creature — Ogre',
      oracle_text: 'Trample.',
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/crasher.jpg' },
      prices: { eur: '0.30' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/crasher',
    };
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        // `unique=prints` = conteggio ristampe del modulo "Prezzo e dati".
        if (u.searchParams.get('unique') === 'prints') body = { total_cards: 42, data: [] };
        else body = { data: [CRASHER, BOLT], has_more: false };
      } else if (u.pathname === '/cards/named') body = BOLT;
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') {
        body = { data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
          { symbol: '{2}', svg_uri: 'https://svgs.test/2.svg' },
        ] };
      }
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Provider LLM finto e tipizzato per azione (riconosciuta dal prompt):
// - chat: traduce "haste" in query, "valuta il mazzo" in evaluate, "tagga…"
//   in tagWith;
// - parere (CARTE DA VALUTARE): un parere numerato per ogni id nel prompt
//   (+ sintesi se il prompt la chiede) — il numero smaschera i ricalcoli;
// - auto-tag (CARTE DA GIUDICARE): "removal" solo a Lightning Bolt.
// Conta le chiamate per tipo in globalThis.__calls (per le asserzioni cache).
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash',
        [C.ACTIONS.DECKS_OPINION]: 'deepseek-flash',
        [C.ACTIONS.DECKS_AUTOTAG]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__calls = { chat: 0, opinion: 0, autotag: 0 };
    let opinionSeq = 0;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      let text;
      if (last.includes('CARTE DA VALUTARE')) {
        globalThis.__calls.opinion++;
        opinionSeq++;
        const ids = [...last.matchAll(/\[id: ([^\]]+)\]/g)].map((m) => m[1]);
        const out = { pareri: ids.map((id) => ({ id, parere: `Parere n.${opinionSeq} su ${id}.` })) };
        if (last.includes('"sintesi"')) out.sintesi = `Sintesi del mazzo n.${opinionSeq}.`;
        text = JSON.stringify(out);
      } else if (last.includes('CARTE DA GIUDICARE')) {
        globalThis.__calls.autotag++;
        const ids = [...last.matchAll(/\[id: ([^\]]+)\]/g)].map((m) => m[1]);
        const map = {};
        for (const id of ids) map[id] = id === 'bolt-1' ? ['removal'] : [];
        text = JSON.stringify(map);
      } else {
        globalThis.__calls.chat++;
        if (/valuta il mazzo/i.test(last)) text = JSON.stringify({ evaluate: 'deck' });
        else if (/tagga/i.test(last)) text = JSON.stringify({ tagWith: ['removal'] });
        else if (/haste/i.test(last)) text = JSON.stringify({ reply: 'Ecco.', query: 'o:haste' });
        else text = JSON.stringify({ reply: 'Ok.' });
      }
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // La chat dei mazzi chiede il reasoning → cammino streaming: delega al
    // mock non-streaming qui sopra.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

async function deckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' });
  }, deckId);
  expect(r && r.ok, 'set commander deve riuscire: ' + JSON.stringify(r)).toBe(true);
  return deckId;
}

// Cerca "haste" in chat e aggiunge Lightning Bolt al mazzo dal toggle.
async function addBoltViaChat(page) {
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await bubble.locator('[data-add="bolt-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toBeVisible();
}

// Apre la preview in hover su una riga del mazzo e sceglie un modulo dal menu
// del tasto destro sul box (il "sistema moduli" di §5.2).
async function chooseModule(page, cardId, label) {
  await page.hover(`#deckList .dk-row[data-card-id="${cardId}"]`);
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: label }).click();
  // Il linger può aver riportato il pannello alle statistiche: ri-hover.
  await page.hover(`#deckList .dk-row[data-card-id="${cardId}"]`);
  await expect(page.locator('#statePreview')).toBeVisible();
}

test('parere di Filo in hover; stantio dopo un edit; Aggiorna lo rigenera', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await addBoltViaChat(page);

  // Modulo "Parere di Filo" scelto col tasto destro sul box (§5.2).
  await chooseModule(page, 'bolt-1', 'Parere di Filo');
  await expect(page.locator('#previewModule .dk-module-title')).toHaveText('Parere di Filo');
  // Il parere della carta arriva (calcolato all'aggiunta o all'hover) ed è
  // FRESCO: niente pallino stantio.
  await expect(page.locator('#previewModule .dk-op-text')).toContainText('Parere n.');
  await expect(page.locator('#previewModule .dk-stale-dot')).toHaveCount(0);

  // EDIT del mazzo (aggiunta di un'altra carta): il parere di Bolt resta
  // visibile ma è marcato stantio — pallino discreto + "Aggiorna" (§6.2).
  await page.locator('.dk-msg-bot').last().locator('[data-add="crasher-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="crasher-1"]')).toBeVisible();
  await page.hover('#deckList .dk-row[data-card-id="bolt-1"]');
  await expect(page.locator('#previewModule .dk-op-text')).toContainText('Parere n.');
  await expect(page.locator('#previewModule .dk-stale-dot')).toBeVisible();
  const staleText = await page.locator('#previewModule .dk-op-text').textContent();

  // Refresh on-demand della singola carta (§6.2): parere nuovo, pallino via.
  const callsBefore = await app.evaluate(() => globalThis.__calls.opinion);
  await page.locator('#previewModule [data-op-refresh]').click();
  await expect(page.locator('#previewModule .dk-op-text')).not.toHaveText(staleText);
  await expect(page.locator('#previewModule .dk-stale-dot')).toHaveCount(0);
  const callsAfter = await app.evaluate(() => globalThis.__calls.opinion);
  expect(callsAfter, 'il refresh fa esattamente una chiamata').toBe(callsBefore + 1);
});

test('"valuta il mazzo" prepara i pareri in batch; l\'hover poi legge la cache senza LLM', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await addBoltViaChat(page);
  await page.locator('.dk-msg-bot').last().locator('[data-add="crasher-1"]').click();
  await expect(page.locator('#deckCount')).toHaveText('2/100 carte');

  // Batch esplicito (§6.1): sintesi in chat + pareri pronti in cache.
  await page.fill('#chatInput', 'valuta il mazzo');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText('Sintesi del mazzo');
  await expect(bubble).toContainText('Parere pronto su 2 carte');

  // L'hover DOPO il batch legge la cache (carta, versione mazzo): il parere
  // compare senza NESSUNA nuova chiamata LLM.
  const callsBefore = await app.evaluate(() => globalThis.__calls.opinion);
  await chooseModule(page, 'crasher-1', 'Parere di Filo');
  await expect(page.locator('#previewModule .dk-op-text')).toContainText('su crasher-1');
  await expect(page.locator('#previewModule .dk-stale-dot')).toHaveCount(0);
  const callsAfter = await app.evaluate(() => globalThis.__calls.opinion);
  expect(callsAfter, 'hover post-batch: zero chiamate nuove').toBe(callsBefore);
});

test('gli altri moduli del box: mini curva con la colonna della carta, prezzo con ristampe e legalità', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await addBoltViaChat(page);

  // Mini curva (§5.2.1): Bolt (cmc 1, nel mazzo) evidenzia la colonna "1".
  await chooseModule(page, 'bolt-1', 'Mini curva di mana');
  await expect(page.locator('#previewModule .dk-curve-mini')).toBeVisible();
  await expect(page.locator('#previewModule .dk-curve-hit')).toHaveAttribute('data-cmc', '1');
  await expect(page.locator('#previewModule')).toContainText('Conta nella colonna 1');
  // Una carta NON nel mazzo mostra dove CADREBBE (segmento fantasma). L'hover
  // parte dalla riga risultati della chat (stesso sistema di preview, §5.1).
  await page.hover('.dk-msg-bot .dk-cardlist .dk-row[data-card-id="crasher-1"]');
  await expect(page.locator('#previewModule .dk-curve-hit')).toHaveAttribute('data-cmc', '4');
  await expect(page.locator('#previewModule .dk-curve-ghost')).toBeVisible();
  await expect(page.locator('#previewModule')).toContainText('Cadrebbe nella colonna 4');

  // Prezzo e dati (§5.2.2): prezzo, ristampe (lazy da Scryfall), legalità.
  await chooseModule(page, 'bolt-1', 'Prezzo e dati');
  await expect(page.locator('#previewModule')).toContainText('1,10 €');
  await expect(page.locator('#previewModule [data-prints]')).toContainText('42 stampe');
  await expect(page.locator('#previewModule [data-legal="1"]')).toContainText('Legale in Commander');
});

test('auto-tag dalla chat: applica i tag e riusa la cache (carta, tag) in un altro mazzo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await deckWithCommander(page);
  await addBoltViaChat(page);
  await page.locator('.dk-msg-bot').last().locator('[data-add="crasher-1"]').click();
  await expect(page.locator('#deckCount')).toHaveText('2/100 carte');

  // "tagga il mazzo con removal" (§7): il giudizio lo fa il SISTEMA in batch.
  await page.fill('#chatInput', 'tagga il mazzo con removal');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Ho taggato 1 carta');

  // Il tag è APPLICATO al mazzo (Bolt sì, Crasher no) e visibile nella UI:
  // raggruppando per tag Bolt sta sotto "removal".
  const deck = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    return r.deck;
  }, deckId);
  expect(deck.carte.find((c) => c.scryfall_id === 'bolt-1').tags).toContain('removal');
  expect(deck.carte.find((c) => c.scryfall_id === 'crasher-1').tags).not.toContain('removal');
  await page.click('#groupBy');
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'per tag' }).click();
  await expect(page.locator('#deckList .dk-group[data-group="removal"] .dk-row[data-card-id="bolt-1"]')).toBeVisible();

  // Cache cross-mazzo (§7): in un SECONDO mazzo con le stesse carte, lo stesso
  // tag si applica SENZA una nuova chiamata LLM (giudizi già in cache).
  const autotagCalls = await app.evaluate(() => globalThis.__calls.autotag);
  expect(autotagCalls).toBe(1);
  const deck2 = await page.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    const c = await chrome.runtime.sendMessage({ type: MSG.DECKS_CREATE, nome: 'Secondo' });
    let d = window.SN_DECKS.addCard(c.deck, 'bolt-1').deck;
    d = window.SN_DECKS.addCard(d, 'crasher-1').deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck: d });
    return c.deck.id;
  });
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, deck2);
  await expect(page.locator('#deckCount')).toHaveText('2/100 carte');
  await page.fill('#chatInput', 'tagga il mazzo con removal');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('Ho taggato 1 carta');
  const after = await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    return r.deck;
  }, deck2);
  expect(after.carte.find((c) => c.scryfall_id === 'bolt-1').tags).toContain('removal');
  const autotagCallsAfter = await app.evaluate(() => globalThis.__calls.autotag);
  expect(autotagCallsAfter, 'secondo mazzo: giudizi dalla cache, zero chiamate').toBe(1);
});
