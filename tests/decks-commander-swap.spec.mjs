// Il commander si sceglie da ogni carta e non si perde mai (#789): tasto destro sui risultati della chat e sui nomi
// citati (aggiungi/rimuovi, imposta come commander, Scryfall), sostituzione dall'elenco che rimette il vecchio
// commander nel mazzo e lo dice, nome del commander nell'intestazione con anteprima e carosello.
// Scryfall e provider finti nel main; i messaggi passano dal cammino IPC vero della pagina.

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cost, cmc, type, colors, slug) => ({
      id, name, mana_cost: cost, cmc, type_line: type, colors, color_identity: colors,
      image_uris: { normal: `https://cards.test/${slug}.jpg`, art_crop: `https://cards.test/${slug}-art.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${slug}`,
    });
    const NIV = card('niv-1', 'Niv-Mizzet, Parun', '{U}{U}{U}{R}{R}{R}', 6, 'Legendary Creature — Dragon Wizard', ['U', 'R'], 'niv');
    const BOLT = card('bolt-1', 'Lightning Bolt', '{R}', 1, 'Instant', ['R'], 'bolt');
    const ELF = card('elf-1', 'Llanowar Elves', '{G}', 1, 'Creature — Elf Druid', ['G'], 'elf');
    const BY_ID = { 'niv-1': NIV, 'bolt-1': BOLT, 'elf-1': ELF };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [NIV, BOLT, ELF], has_more: false };
      else if (u.pathname === '/cards/named') body = NIV;
      else if (u.pathname === '/cards/collection') body = { data: [] };
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Una query tutta in sintassi non passa dal giudice: i risultati sono esattamente quelli di Scryfall.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const last = String(messages[messages.length - 1].content || '');
      const text = /^is:commander/.test(last)
        ? JSON.stringify({ query: 'is:commander' })
        : /consigliami/i.test(last)
          ? JSON.stringify({ reply: 'Prova [[Niv-Mizzet, Parun]].' })
          : JSON.stringify({ reply: 'Ok.' });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

async function newDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  return page.evaluate(() => decodeURIComponent(location.hash.replace('#/deck/', '')));
}

function getDeck(page, id) {
  return page.evaluate(async (deckId) => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_GET, id: deckId });
    return r && r.ok ? r.deck : null;
  }, id);
}

// Commander e carte scritti nello store, poi la pagina ricaricata: è lo stato da cui parte l'utente.
async function seed(page, id, { commander, cards = [] }) {
  await page.evaluate(async ({ deckId, commander, cards }) => {
    const { MSG } = window.SN_MSG;
    if (commander) await chrome.runtime.sendMessage({ type: MSG.DECKS_SET_COMMANDER, id: deckId, scryfallId: commander });
    let deck = (await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id: deckId })).deck;
    for (const c of cards) deck = window.SN_DECKS.addCard(deck, c).deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, { deckId: id, commander, cards });
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

const menu = (page) => page.locator('.dk-ctxmenu .sn-select-option');

test('tasto destro su un risultato in chat: imposta come commander, aggiungi e rimuovi, apri su Scryfall', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);

  await page.fill('#chatInput', 'is:commander');
  await page.press('#chatInput', 'Enter');
  const results = page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row');
  await expect(results).toHaveCount(3);

  const niv = results.filter({ hasText: 'Niv-Mizzet, Parun' });
  await niv.click({ button: 'right' });
  await expect(menu(page)).toHaveText(['Aggiungi al mazzo', 'Imposta come commander', 'Apri su Scryfall']);
  await menu(page).filter({ hasText: 'Imposta come commander' }).click();

  await expect(page.locator('#commanderLine')).toContainText('Niv-Mizzet, Parun');
  // Il nome del mazzo segue il commander finché l'utente non l'ha rinominato.
  await expect(page.locator('#deckNameText')).toHaveText('Niv-Mizzet, Parun');
  const deck = await getDeck(page, deckId);
  expect(deck.commander).toBe('niv-1');
  expect(deck.commanderMeta.colors).toEqual(['U', 'R']);
  // È il commander, non anche una carta dell'elenco: la riga lo dice e il + non lo duplica.
  await expect(niv.locator('.dk-add')).toHaveAttribute('data-in', 'cmd');
  await niv.locator('.dk-add').click();
  await expect(page.locator('#deckList .dk-row')).toHaveCount(0);
  await niv.click({ button: 'right' });
  await expect(menu(page)).toHaveText(['Rimuovi commander', 'Apri su Scryfall']);
  await page.keyboard.press('Escape');

  const bolt = results.filter({ hasText: 'Lightning Bolt' });
  await bolt.click({ button: 'right' });
  await menu(page).filter({ hasText: 'Aggiungi al mazzo' }).click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toHaveCount(1);
  await expect(bolt.locator('.dk-add')).toHaveAttribute('data-in', '1');
  await bolt.click({ button: 'right' });
  await menu(page).filter({ hasText: 'Rimuovi dal mazzo' }).click();
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toHaveCount(0);

  // «Apri su Scryfall» chiede di aprire la pagina della carta (intercettato per non aprire schede).
  await page.evaluate(() => {
    window.__opened = [];
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...rest) => {
      if (m && m.type === window.SN_MSG.MSG.OPEN_URL) { window.__opened.push(m.url); return Promise.resolve({ ok: true }); }
      return orig(m, ...rest);
    };
  });
  await results.filter({ hasText: 'Llanowar Elves' }).click({ button: 'right' });
  await menu(page).filter({ hasText: 'Apri su Scryfall' }).click();
  await expect.poll(() => page.evaluate(() => window.__opened)).toEqual(['https://scryfall.com/card/elf']);
});

test('tasto destro su un nome citato in chat: imposta come commander', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);

  await page.fill('#chatInput', 'consigliami un commander izzet');
  await page.press('#chatInput', 'Enter');
  const name = page.locator('.dk-msg-bot').last().locator('.dk-prose-card', { hasText: 'Niv-Mizzet, Parun' });
  await name.click({ button: 'right' });
  await menu(page).filter({ hasText: 'Imposta come commander' }).click();
  await expect(page.locator('#commanderLine')).toContainText('Niv-Mizzet, Parun');
  expect((await getDeck(page, deckId)).commander).toBe('niv-1');
});

test('sostituire il commander dall\'elenco rimette il vecchio nel mazzo e lo dice; togliere fa lo stesso', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seed(page, deckId, { commander: 'bolt-1', cards: ['niv-1', 'elf-1'] });
  await expect(page.locator('#commanderLine')).toContainText('Lightning Bolt');

  await page.locator('#deckList .dk-row[data-card-id="niv-1"]').click({ button: 'right' });
  await menu(page).filter({ hasText: 'Imposta come commander' }).click();

  await expect(page.locator('#commanderLine')).toContainText('Niv-Mizzet, Parun');
  await expect(page.locator('#deckList .dk-row[data-card-id="niv-1"]')).toHaveCount(0);
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toHaveCount(1);
  await expect(page.locator('#dkToast')).toContainText('Lightning Bolt torna nel mazzo come carta normale');
  const after = await getDeck(page, deckId);
  expect(after.commander).toBe('niv-1');
  expect(after.carte.map((c) => c.scryfall_id).sort()).toEqual(['bolt-1', 'elf-1']);

  await page.locator('#commanderLine .dk-prose-card').click({ button: 'right' });
  await menu(page).filter({ hasText: 'Rimuovi commander' }).click();
  await expect(page.locator('#commanderLine')).toContainText('Nessun commander');
  await expect(page.locator('#deckList .dk-row[data-card-id="niv-1"]')).toHaveCount(1);
  await expect(page.locator('#dkToast')).toContainText('Niv-Mizzet, Parun torna nel mazzo come carta normale');
});

test('il nome del commander nell\'intestazione: anteprima al passaggio, carosello al clic', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seed(page, deckId, { commander: 'niv-1' });

  const name = page.locator('#commanderLine .dk-prose-card');
  await expect(name).toHaveText('Niv-Mizzet, Parun');
  await name.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await expect(page.locator('#previewImg')).toHaveAttribute('src', 'https://cards.test/niv.jpg');

  await name.click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await expect(page.locator('#carouselImg')).toHaveAttribute('src', 'https://cards.test/niv.jpg');
  await expect(page.locator('#carouselToggle')).toHaveText('✓ commander');
  // Invio nel carosello non duplica il commander fra le carte.
  await page.keyboard.press('Enter');
  await page.locator('#carouselToggle').click();
  await expect(page.locator('#deckList .dk-row')).toHaveCount(0);
  expect((await getDeck(page, deckId)).carte).toEqual([]);
});
