// Chat unificata del Builder (task 5, DECK-BUILDER-SPEC.md §3-§4): la barra di
// ricerca È la chat. Il provider LLM è MOCKATO nel main (niente rete: traduce
// "haste" in una query Scryfall) e Scryfall pure (SN_SCRYFALL._setFetch), ma i
// messaggi viaggiano sul cammino IPC reale della pagina. Si asserisce il
// SUCCESSO: la ricerca produce una CardList renderizzata dai dati, il filtro di
// color identity finisce nella richiesta Scryfall, il toggle aggiunge la carta
// alla colonna centrale, la bolla vecchia collassa a riga di sintesi
// riespandibile e i [[Nomi Carta]] in prosa diventano span.

import { test, expect } from './fixtures/electron.mjs';

// Mini-API Scryfall finta nel main + registro delle richieste (per asserire il
// vincolo id<= automatico sulla ricerca della chat).
async function mockScryfall(app) {
  await app.evaluate(() => {
    const COMMANDER = {
      id: 'niv-1',
      name: 'Niv-Mizzet, Parun',
      mana_cost: '{U}{U}{U}{R}{R}{R}',
      cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard',
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
      colors: ['R'],
      color_identity: ['R'],
      image_uris: { normal: 'https://cards.test/crasher.jpg' },
      prices: { eur: '0.30' },
      legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/crasher',
    };
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      // Ordine volutamente NON per cmc: la UI deve riordinare per CMC (§3.4).
      if (u.pathname === '/cards/search') body = { data: [CRASHER, BOLT], has_more: false };
      else if (u.pathname === '/cards/named') body = BOLT;
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

// Provider LLM finto: config deterministica (chiave finta, nessuna rete) e
// risposta tipizzata — le richieste con "haste" diventano una ricerca, il
// resto solo conversazione. Cattura i messages per ispezione.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    globalThis.__chatCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      const last = String(messages[messages.length - 1].content || '');
      const text = /haste/i.test(last)
        ? JSON.stringify({ reply: 'Per la fretta guarda [[Lightning Bolt]].', query: 'o:haste' })
        : JSON.stringify({ reply: 'Il mazzo mi sembra a buon punto.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // La chat dei mazzi vuole il reasoning → passa dal cammino streaming:
    // emette i chunk di CoT impostati dal test e delega la risposta al mock
    // non-streaming qui sopra.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onReasoning }) => {
      for (const t of (globalThis.__reasoningChunks || [])) {
        try { onReasoning && onReasoning(t); } catch (_) {}
      }
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

// Mazzo nuovo con commander Izzet (U/R) impostato via IPC, builder aperto.
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

test('la ricerca in chat produce una CardList e il toggle aggiunge la carta al mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Frase conversazionale → l'LLM la traduce in query → CardList di DATI.
  await page.fill('#chatInput', 'modi per dare haste alle creature');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(2);

  // Righe ordinate per CMC crescente (§3.4) anche se Scryfall risponde sparso.
  await expect(bubble.locator('.dk-row-name').nth(0)).toHaveText('Lightning Bolt');
  await expect(bubble.locator('.dk-row-name').nth(1)).toHaveText('Embercleave Crasher');

  // Filtro color identity AUTOMATICO (§4): la richiesta a Scryfall porta
  // id<=UR anche se né l'utente né il mock LLM l'hanno scritto.
  const searchReq = await app.evaluate(() =>
    (globalThis.__scryRequests || []).find((u) => u.includes('/cards/search')));
  expect(searchReq, 'la ricerca Scryfall deve partire').toBeTruthy();
  expect(decodeURIComponent(searchReq)).toContain('id<=UR');

  // Il nome in prosa [[Lightning Bolt]] è uno span hoverable (§3.5).
  await expect(bubble.locator('.dk-prose-card')).toHaveText('Lightning Bolt');

  // Toggle "aggiungi al mazzo" (§3.4): la carta compare nella colonna centrale
  // nel gruppo giusto e il conteggio avanza — feedback immediato (§5.3).
  await bubble.locator('[data-add="bolt-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toBeVisible();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
  await expect(page.locator('#deckList .dk-group-head')).toContainText('Istantanei');
  // Il toggle ora mostra lo stato "già nel mazzo" e sa anche rimuovere.
  const toggle = page.locator('.dk-msg-bot').last().locator('[data-add="bolt-1"]');
  await expect(toggle).toHaveAttribute('data-in', '1');
  await toggle.click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toHaveCount(0);
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');
});

test('le bolle precedenti collassano a riga di sintesi riespandibile', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  const first = page.locator('.dk-msg-bot').first();
  await expect(first.locator('.dk-cardlist')).toBeVisible();

  // Secondo scambio (solo conversazione): la PRIMA bolla collassa alla riga
  // di sintesi (§3.3), la nuova bolla non ha CardList.
  await page.fill('#chatInput', 'che ne pensi del mazzo?');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(2);
  const second = page.locator('.dk-msg-bot').nth(1);
  await expect(second).toContainText('a buon punto');
  await expect(second.locator('.dk-cardlist')).toHaveCount(0);
  await expect(first.locator('.dk-cardlist')).toBeHidden();
  await expect(first.locator('.dk-list-summary')).toContainText('2 risultati');

  // Riespandibile al click, dai DATI salvati (§3.2): le righe ricompaiono.
  await page.locator('.dk-msg-bot').first().locator('.dk-list-summary').click();
  await expect(page.locator('.dk-msg-bot').first().locator('.dk-cardlist')).toBeVisible();
  await expect(page.locator('.dk-msg-bot').first().locator('.dk-cardlist .dk-row')).toHaveCount(2);

  // La cronologia passata all'agente contiene lo scambio precedente: può
  // riferirsi a "i risultati di prima" perché sono dati, non prosa.
  const calls = await app.evaluate(() => globalThis.__chatCalls.map((ms) => ms.length));
  expect(calls.length).toBe(2);
  expect(calls[1]).toBeGreaterThan(calls[0]);
});
