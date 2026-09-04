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
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
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

// #331.1 — il ragionamento del modello (CoT) è visibile nella bolla come
// blocco collassabile: un click lo apre (testo completo), un click lo chiude.
test('il ragionamento del modello è visibile e collassabile al click', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    globalThis.__reasoningChunks = ['Sto valutando ', 'le carte con haste nel formato Commander.'];
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'che ne pensi del mazzo?');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText('a buon punto');

  // A risposta arrivata il blocco c'è, collassato: il testo NON è visibile.
  const cot = bubble.locator('.dk-cot');
  await expect(cot).toBeVisible();
  await expect(cot).toContainText('Ragionamento');
  await expect(bubble.locator('.dk-cot-body')).toHaveCount(0);

  // Click → si apre col testo completo del ragionamento (chunk concatenati).
  await cot.click();
  const body = page.locator('.dk-msg-bot').last().locator('.dk-cot-body');
  await expect(body).toBeVisible();
  await expect(body).toHaveText('Sto valutando le carte con haste nel formato Commander.');
  // Traccia visiva ispezionabile (gitignorata).
  await page.screenshot({ path: 'tests/.shots/decks-chat-cot-aperto.png' });

  // Click di nuovo (sul blocco aperto) → si richiude.
  await page.locator('.dk-msg-bot').last().locator('.dk-cot').click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toHaveCount(0);
});

// #331.3 — una query Scryfall invalida (400) NON butta il turno: il sistema fa
// correggere la query al modello e riprova. SUCCESSO = la CardList arriva
// comunque, senza bolla d'errore.
test('query Scryfall rifiutata (400) → il modello la corregge e i risultati arrivano', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  // Sovrascrive LLM e Scryfall: la query ROTTA (parentesi orfana) risponde
  // 400 con details; quella corretta dal retry funziona.
  await app.evaluate(() => {
    // LLM: primo turno → query ROTTA; il messaggio di sistema di correzione
    // ("(Sistema) La ricerca Scryfall…") → query corretta.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      const last = String(messages[messages.length - 1].content || '');
      const text = /\(Sistema\) La ricerca Scryfall/.test(last)
        ? JSON.stringify({ reply: 'Query sistemata.', query: 'o:haste' })
        : JSON.stringify({ reply: 'Cerco carte con haste.', query: 't:dinosaur (o:"deal' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // Il fetch Scryfall: 400 con details sulla query rotta.
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        const q = u.searchParams.get('q') || '';
        if (q.includes('(')) {
          return { ok: false, status: 400, json: async () => ({ object: 'error', details: 'Unmatched parenthesis in search expression.' }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: [{
          id: 'bolt-1', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1,
          type_line: 'Instant', colors: ['R'], color_identity: ['R'],
          image_uris: { normal: 'https://cards.test/bolt.jpg' },
          prices: { eur: '1.10' }, legalities: { commander: 'legal' },
          scryfall_uri: 'https://scryfall.com/card/bolt',
        }], has_more: false }) };
      }
      if (u.pathname === '/cards/niv-1') {
        return { ok: true, status: 200, json: async () => ({
          id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
          type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
          image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
          prices: { eur: '3.21' }, legalities: { commander: 'legal' },
          scryfall_uri: 'https://scryfall.com/card/niv',
        }) };
      }
      if (u.pathname === '/symbology') {
        return { ok: true, status: 200, json: async () => ({ data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
        ] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'dinosauri che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  // SUCCESSO: i risultati arrivano nonostante il 400 sulla prima query.
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Lightning Bolt');
  // Nessuna bolla d'errore e nessun codice tecnico in chat.
  await expect(page.locator('.dk-msg-error')).toHaveCount(0);
  await expect(page.locator('#chatLog')).not.toContainText('400');
  // Il retry è partito con il dettaglio dell'errore Scryfall nel prompt.
  const retryCall = await app.evaluate(() => globalThis.__chatCalls
    .map((ms) => String(ms[ms.length - 1].content || ''))
    .find((c) => c.includes('(Sistema) La ricerca Scryfall')));
  expect(retryCall).toBeTruthy();
  expect(retryCall).toContain('Unmatched parenthesis');
});

// #351 — l'agente NON deve MAI proporre carte fuori dai colori del commander,
// nemmeno se il modello si scrive da solo un vincolo `id:` sbagliato nella query
// (che il filtro sulla stringa lascia passare per rispettare l'override manuale).
// SUCCESSO = la carta fuori identità NON compare nella CardList; resta solo
// quella legale, e la bolla avvisa che una carta è stata esclusa.
test('carte fuori dai colori del commander vengono filtrate dai risultati dell\'agente', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    // Il modello, "aiutando", aggiunge un vincolo id:B esplicito → Scryfall
    // restituisce anche una carta NERA, fuori dall'identità Izzet (U/R).
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      return {
        text: JSON.stringify({ reply: 'Ecco qualche pescata.', query: 'o:draw id:B' }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        return { ok: true, status: 200, json: async () => ({ data: [
          // Legale (blu, dentro U/R).
          { id: 'ponder-1', name: 'Ponder', mana_cost: '{U}', cmc: 1, type_line: 'Sorcery',
            colors: ['U'], color_identity: ['U'], image_uris: { normal: 'https://cards.test/ponder.jpg' },
            prices: { eur: '0.50' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/ponder' },
          // FUORI identità (nera): deve sparire dai risultati proposti.
          { id: 'sign-1', name: 'Sign in Blood', mana_cost: '{B}{B}', cmc: 2, type_line: 'Sorcery',
            colors: ['B'], color_identity: ['B'], image_uris: { normal: 'https://cards.test/sign.jpg' },
            prices: { eur: '0.40' }, legalities: { commander: 'legal' }, scryfall_uri: 'https://scryfall.com/card/sign' },
        ], has_more: false }) };
      }
      if (u.pathname === '/cards/niv-1') {
        return { ok: true, status: 200, json: async () => ({
          id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
          type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
          image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
          prices: { eur: '3.21' }, legalities: { commander: 'legal' },
          scryfall_uri: 'https://scryfall.com/card/niv',
        }) };
      }
      if (u.pathname === '/symbology') {
        return { ok: true, status: 200, json: async () => ({ data: [
          { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
          { symbol: '{B}', svg_uri: 'https://svgs.test/B.svg' },
        ] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'dammi delle pescate');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  // Solo la carta legale sopravvive: una riga, ed è Ponder — la nera sparisce.
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  await expect(bubble.locator('.dk-row-name').first()).toHaveText('Ponder');
  await expect(page.locator('#chatLog')).not.toContainText('Sign in Blood');
  // Nessun modo di aggiungere la carta nera: la sua riga/bottone non esiste.
  await expect(bubble.locator('[data-add="sign-1"]')).toHaveCount(0);
  // Trasparenza: la bolla avvisa dell'esclusione.
  await expect(bubble).toContainText(/fuori dai colori del commander/i);
  await page.screenshot({ path: 'tests/.shots/decks-chat-identity-filter.png' });
});

// #331.2 — se anche il retry fallisce, l'utente riceve una SPIEGAZIONE in
// italiano nella bolla normale (con la reply originale preservata), non una
// bolla d'errore con un codice HTTP.
test('doppio fallimento Scryfall → spiegazione chiara, niente codice 400', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    // LLM: risponde SEMPRE con la stessa query rotta (anche al retry).
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      return {
        text: JSON.stringify({ reply: 'Provo a cercare i dinosauri.', query: 't:dinosaur (o:"deal' }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    // Scryfall: /cards/search risponde SEMPRE 400.
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        return { ok: false, status: 400, json: async () => ({ object: 'error', details: 'Unmatched parenthesis in search expression.' }) };
      }
      if (u.pathname === '/cards/niv-1') {
        return { ok: true, status: 200, json: async () => ({
          id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
          type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
          image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
          prices: { eur: '3.21' }, legalities: { commander: 'legal' },
          scryfall_uri: 'https://scryfall.com/card/niv',
        }) };
      }
      if (u.pathname === '/symbology') {
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'dinosauri che fanno danni');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  // La bolla è NORMALE (niente classe errore), la reply del modello resta
  // visibile e la spiegazione invita a riformulare — mai "400" nudo.
  await expect(bubble).toContainText('Provo a cercare i dinosauri.');
  await expect(bubble).toContainText(/riformulare/i);
  await expect(page.locator('.dk-msg-error')).toHaveCount(0);
  await expect(page.locator('#chatLog')).not.toContainText('Scryfall 400');
  // Traccia visiva ispezionabile (gitignorata).
  await page.screenshot({ path: 'tests/.shots/decks-chat-scryfall-fallito.png' });
  // Il retry è stato tentato (2 chiamate LLM), poi il sistema ha spiegato.
  expect(await app.evaluate(() => globalThis.__chatCalls.length)).toBe(2);
});
