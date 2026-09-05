// Pannello destro a tre stati del Builder (task 6, DECK-BUILDER-SPEC.md §5):
// statistiche a riposo, preview UNIFICATA su hover (apertura ~200ms,
// aggiornamento sul posto riga→riga, ritorno alle statistiche dopo ~1s di
// linger) e carosello di triage al click (indicatore posizione, navigazione
// da tastiera, Invio aggiunge/rimuove e la riga appare nel gruppo giusto
// della colonna centrale, Esc chiude). Scryfall e provider LLM mockati nel
// main: niente rete. Si asserisce il SUCCESSO (immagine giusta, carta davvero
// aggiunta/rimossa), non l'assenza di errori.

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
  'c-goblin': {
    id: 'c-goblin', name: 'Goblin Guide', mana_cost: '{R}', cmc: 1,
    type_line: 'Creature — Goblin Scout', colors: ['R'], color_identity: ['R'],
    image_uris: { normal: 'https://cards.test/goblin.jpg', art_crop: 'https://cards.test/goblin-art.jpg' },
    prices: { eur: '2.10' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/goblin',
  },
  // Bifronte (transform): niente image_uris in radice, ogni faccia ha la sua.
  'c-delver': {
    id: 'c-delver', name: 'Delver of Secrets // Insectile Aberration',
    cmc: 1, color_identity: ['U'],
    card_faces: [
      { name: 'Delver of Secrets', mana_cost: '{U}', type_line: 'Creature — Human Wizard',
        colors: ['U'], image_uris: { normal: 'https://cards.test/delver-front.jpg', art_crop: 'https://cards.test/delver-art.jpg' } },
      { name: 'Insectile Aberration', mana_cost: '', type_line: 'Creature — Human Insect',
        image_uris: { normal: 'https://cards.test/delver-back.jpg' } },
    ],
    prices: { eur: '0.30' }, legalities: { commander: 'legal' },
    scryfall_uri: 'https://scryfall.com/card/delver',
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
      else if (u.pathname === '/cards/search') {
        // Risultati per la chat: goblin + dragon (ordine non-CMC di proposito).
        body = { data: [CARDS['c-dragon'], CARDS['c-goblin']], has_more: false };
      } else if (u.pathname === '/symbology') {
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

// Provider LLM finto per la chat (stesso pattern di decks-chat.spec.mjs):
// qualsiasi richiesta diventa una ricerca Scryfall.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ reply: 'Ecco qualche opzione.', query: 'o:haste' }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    // La chat dei mazzi chiede il reasoning → cammino streaming: delega al
    // mock non-streaming qui sopra.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

// Mazzo con Lightning Bolt + Shivan Dragon dentro, builder aperto.
async function seedDeck(page, ids = [['c-bolt', 1], ['c-dragon', 1]]) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const hash = await page.evaluate(() => location.hash);
  const deckId = decodeURIComponent(hash.replace('#/deck/', ''));
  await page.evaluate(async ({ id, ids }) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    let deck = r.deck;
    for (const [cid, qty] of ids) deck = window.SN_DECKS.addCard(deck, cid, { qty }).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, { id: deckId, ids });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#deckList .dk-row')).toHaveCount(ids.length);
  return deckId;
}

test('hover su una riga apre la preview, riga→riga aggiorna sul posto, il linger torna alle statistiche', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Riposo: statistiche visibili, preview nascosta.
  await expect(page.locator('#stateStats')).toBeVisible();
  await expect(page.locator('#statePreview')).toBeHidden();

  // Hover sulla riga del Bolt: dopo il ritardo anti-flicker compare la
  // preview con l'IMMAGINE della carta (caricata solo ora), il prezzo EUR e
  // l'indicatore "già nel mazzo"; il box modulare mostra il modulo default.
  await page.locator('#deckList .dk-row', { hasText: 'Lightning Bolt' }).hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg');
  await expect(page.locator('#previewCtx')).toContainText('1,50 €');
  await expect(page.locator('#previewCtx')).toContainText('già nel mazzo');
  await expect(page.locator('#previewModule')).toContainText('Instant');
  await expect(page.locator('#detailTitle')).toHaveText('Anteprima');
  // La geometria non cambia mai (§5): la colonna resta la stessa.
  const wBefore = await page.locator('#colDetail').evaluate((el) => el.getBoundingClientRect().width);

  // Passaggio riga→riga: il contenuto si AGGIORNA (immagine del drago),
  // senza tornare alle statistiche.
  await page.locator('#deckList .dk-row', { hasText: 'Shivan Dragon' }).hover();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg');
  await expect(page.locator('#statePreview')).toBeVisible();
  const wAfter = await page.locator('#colDetail').evaluate((el) => el.getBoundingClientRect().width);
  expect(wAfter).toBe(wBefore);

  // Uscita: mouse fuori dalle righe → dopo il linger (~1s) tornano le
  // statistiche (non subito: a 300ms la preview è ancora lì).
  await page.locator('#detailTitle').hover();
  await page.waitForTimeout(300);
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#stateStats')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#statePreview')).toBeHidden();
});

// Spia che registra ogni assegnazione JS di `img.src` (le immagini scritte via
// innerHTML NON passano di qui: cattura SOLO i precarichi `new Image().src` e la
// preview). Va installata come init script, così sopravvive al reload di seedDeck.
async function spyImageSrc(page) {
  await page.addInitScript(() => {
    window.__imgSrcs = [];
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true, enumerable: d.enumerable,
      get() { return d.get.call(this); },
      set(v) { try { window.__imgSrcs.push(String(v)); } catch { /* noop */ } d.set.call(this, v); },
    });
  });
}

test('le immagini delle carte del mazzo sono precaricate appena il mazzo appare, PRIMA di qualsiasi hover', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await spyImageSrc(page);
  await seedDeck(page); // reload interno → l'init script è attivo al render

  // Il mazzo è renderizzato ma nessuna riga è stata toccata: senza precarico le
  // immagini si scalderebbero solo all'hover (asserzione ROSSA senza il fix).
  await expect(page.locator('#deckList .dk-row')).toHaveCount(2);
  await page.waitForFunction(
    () => window.__imgSrcs
      && window.__imgSrcs.includes('https://cards.test/bolt.jpg')
      && window.__imgSrcs.includes('https://cards.test/dragon.jpg'),
    null, { timeout: 5000 },
  );

  // La preview non è mai stata aperta: il precarico è avvenuto da solo.
  await expect(page.locator('#statePreview')).toBeHidden();
});

test('click su una riga del mazzo apre il carosello: tastiera per navigare, rimuovere e riaggiungere, Esc chiude', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page);

  // Click sulla riga del Bolt → carosello pinnato sull'ordine VISIBILE del
  // mazzo (gruppi per tipo: Creature prima, Istantanei dopo → il Bolt è 2/2).
  await page.locator('#deckList .dk-row', { hasText: 'Lightning Bolt' }).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselPos')).toHaveText('2/2');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg');
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '1');

  // ← passa al drago (1/2); → torna al Bolt.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#carouselPos')).toHaveText('1/2');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/dragon.jpg');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#carouselPos')).toHaveText('2/2');

  // Invio RIMUOVE il Bolt (era nel mazzo): sparisce dalla colonna centrale,
  // il toggle passa a "aggiungi". Il carosello resta pinnato.
  await page.keyboard.press('Enter');
  await expect(page.locator('#deckList .dk-row', { hasText: 'Lightning Bolt' })).toHaveCount(0);
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '0');
  await expect(page.locator('#stateCarousel')).toBeVisible();

  // Spazio lo RIAGGIUNGE: la riga riappare nel gruppo giusto (Istantanei).
  await page.keyboard.press(' ');
  await expect(page.locator('.dk-group[data-group="Istantanei"] .dk-row', { hasText: 'Lightning Bolt' })).toHaveCount(1);
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '1');

  // L'hover NON scalza il carosello pinnato (§5).
  await page.locator('#deckList .dk-row', { hasText: 'Shivan Dragon' }).hover();
  await page.waitForTimeout(400);
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#statePreview')).toBeHidden();

  // Esc chiude → statistiche.
  await page.keyboard.press('Escape');
  await expect(page.locator('#stateStats')).toBeVisible();
  await expect(page.locator('#stateCarousel')).toBeHidden();
});

test('dai risultati della chat: click apre il carosello su quella lista e Invio aggiunge al mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page, [['c-bolt', 1]]);

  // Una ricerca in chat produce la CardList (goblin + dragon, ordinati CMC).
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  const rows = page.locator('.dk-cardlist .dk-row');
  await expect(rows).toHaveCount(2);

  // Click sulla prima riga (Goblin Guide, CMC 1) → carosello sulla lista
  // della bolla: 1/2, immagine del goblin, NON ancora nel mazzo.
  await rows.nth(0).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselPos')).toHaveText('1/2');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/goblin.jpg');
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '0');

  // Invio AGGIUNGE: la riga appare nel gruppo giusto della colonna centrale
  // (Creature) — il mazzo cresce sotto gli occhi (§5.3).
  await page.keyboard.press('Enter');
  await expect(page.locator('.dk-group[data-group="Creature"] .dk-row', { hasText: 'Goblin Guide' })).toHaveCount(1);
  await expect(page.locator('#carouselToggle')).toHaveAttribute('data-in', '1');
  await expect(page.locator('#deckCount')).toHaveText('2/100 carte');
});

// Carte bifronte (feedback #373): il tasto "gira" mostra il retro, sia nella
// preview su hover sia nel carosello; il click sull'immagine fa lo stesso. Le
// carte a faccia unica NON hanno il tasto. Si asserisce il SUCCESSO (l'immagine
// del retro compare davvero), non l'assenza di errori.
test('carta bifronte: il tasto gira mostra il retro in preview e carosello; carta singola non ha il tasto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page, [['c-delver', 1], ['c-bolt', 1]]);

  // Hover sulla riga bifronte → preview col FRONTE e il tasto "gira" visibile.
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');
  await expect(page.locator('#previewFlip')).toBeVisible();

  // Click sul tasto → compare il RETRO (senza il fix il tasto non esiste e
  // l'immagine resterebbe il fronte: asserzione ROSSA).
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-back.jpg');
  // Ri-cliccando il tasto torna il fronte.
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');

  // Hover su una carta a faccia unica → nessun tasto "gira".
  await page.locator('#deckList .dk-row', { hasText: 'Lightning Bolt' }).hover();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/bolt.jpg');
  await expect(page.locator('#previewFlip')).toBeHidden();

  // Nel carosello: click sulla riga bifronte → fronte + tasto gira; il click
  // sull'IMMAGINE stessa la volta (gesto fisico), e navigare resetta al fronte.
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');
  await expect(page.locator('#carouselFlip')).toBeVisible();
  await page.click('#carouselImg');
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/delver-back.jpg');
});

// Carta bifronte (feedback #373): ogni RIAPERTURA della preview riparte dal
// FRONTE, anche tornando sulla STESSA carta. Prima del fix, una carta girata sul
// retro e ri-hoverata (dopo che l'anteprima si era chiusa tornando alle
// statistiche) riapriva ancora sul retro, in modo incoerente col cambio carta.
// Si asserisce il SUCCESSO: alla riapertura compare l'immagine del FRONTE.
test('carta bifronte: la riapertura della preview riparte dal fronte, anche sulla stessa carta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedDeck(page, [['c-delver', 1], ['c-bolt', 1]]);

  // Hover sulla bifronte → preview col FRONTE; giro sul retro.
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');
  await page.click('#previewFlip');
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-back.jpg');

  // Allontano il mouse dalle righe → dopo il linger l'anteprima si chiude e
  // tornano le statistiche (la carta resta "girata sul retro" nello slot).
  await page.locator('#detailTitle').hover();
  await expect(page.locator('#stateStats')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#statePreview')).toBeHidden();

  // Ri-hover sulla STESSA carta → la preview si riapre dal FRONTE (senza il fix
  // riaprirebbe ancora sul retro: asserzione ROSSA).
  await page.locator('#deckList .dk-row', { hasText: 'Delver of Secrets' }).hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/delver-front.jpg');
});
