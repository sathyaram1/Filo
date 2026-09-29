// La chat del banco di lavoro di un mazzo resta dopo una ricarica e dopo un riavvio di Filo, mazzo per mazzo (#787).
// Provider e Scryfall sono finti nel main, i messaggi viaggiano sul cammino IPC vero della pagina. Si asserisce quello
// che vede l'utente: bolle e liste di nuovo lì, il + che mette la carta nel mazzo, lo storico che arriva al modello.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cost, cmc, type, ci) => ({
      id, name, mana_cost: cost, cmc, type_line: type, colors: ci, color_identity: ci,
      image_uris: { normal: `https://cards.test/${id}.jpg`, art_crop: `https://cards.test/${id}-art.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const COMMANDER = card('niv-1', 'Niv-Mizzet, Parun', '{U}{U}{U}{R}{R}{R}', 6, 'Legendary Creature — Dragon Wizard', ['U', 'R']);
    const BOLT = card('bolt-1', 'Lightning Bolt', '{R}', 1, 'Instant', ['R']);
    const CRASHER = card('crasher-1', 'Embercleave Crasher', '{2}{R}{R}', 4, 'Creature — Ogre', ['R']);
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT, 'crasher-1': CRASHER };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [CRASHER, BOLT], has_more: false };
      else if (u.pathname === '/cards/named') body = BOLT;
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [{ symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' }] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// "haste" → ricerca con un nome in prosa; il resto solo conversazione. Il provider si può TRATTENERE (la risposta
// resta in volo finché il test non lo libera) e ogni chiamata registra i messaggi che ha ricevuto.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__chatCalls = [];
    globalThis.__trattieni = null;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      if (globalThis.__trattieni) await globalThis.__trattieni;
      const last = String(messages[messages.length - 1].content || '');
      const text = /haste/i.test(last)
        ? JSON.stringify({ reply: 'Per la fretta guarda [[Lightning Bolt]].', query: 'o:haste' })
        : JSON.stringify({ reply: `Risposta a: ${last}` });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onReasoning }) => {
      try { onReasoning && onReasoning('Penso ai colori del commander.'); } catch (_) {}
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

async function trattieni(app) {
  await app.evaluate(() => { globalThis.__trattieni = new Promise((r) => { globalThis.__libera = r; }); });
}
async function libera(app) {
  await app.evaluate(() => { const r = globalThis.__libera; globalThis.__trattieni = null; if (r) r(); });
}

async function newDeckWithCommander(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  const r = await page.evaluate(async (id) => chrome.runtime.sendMessage(
    { type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  expect(r && r.ok).toBe(true);
  return deckId;
}

async function ask(page, text) {
  const before = await page.locator('.dk-msg-bot').count();
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(before + 1);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0);
}

async function savedChats(app) {
  return app.evaluate(async () => {
    const k = globalThis.SN_CONST.STORAGE_KEYS.DECK_CHATS;
    return (await globalThis.chrome.storage.local.get(k))[k] || {};
  });
}

async function reloadBuilder(page) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}

test('ricaricata la pagina la chat c\'è ancora: liste, nomi in prosa, + e storico per il modello', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);

  await ask(page, 'modi per dare haste');
  await ask(page, 'altre carte con haste');
  await expect.poll(async () => ((await savedChats(app))[deckId] || { messages: [] }).messages.length).toBe(4);

  await reloadBuilder(page);
  const bots = page.locator('.dk-msg-bot');
  await expect(page.locator('.dk-msg-user')).toHaveText(['modi per dare haste', 'altre carte con haste']);
  await expect(bots).toHaveCount(2);
  await expect(page.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0);
  // La vecchia chiusa sulla riga di sintesi, l'ultima aperta.
  await expect(bots.first().locator('.dk-list-summary')).toHaveAttribute('aria-expanded', 'false');
  await expect(bots.first().locator('.dk-cardlist')).toBeHidden();
  await expect(bots.first().locator('.dk-list-summary')).toContainText('2 risultati');
  const rows = bots.last().locator('.dk-cardlist .dk-row');
  await expect(rows).toHaveCount(2);
  // Nomi dalla cache carte, non gli id; ordine per costo come prima.
  await expect(rows.locator('.dk-row-name')).toHaveText(['Lightning Bolt', 'Embercleave Crasher']);
  // Il ragionamento c'è, chiuso.
  await expect(bots.last().locator('.dk-cot')).toHaveAttribute('data-open', '0');

  // Il nome citato nel testo si passa col mouse (anteprima) e si clicca (carosello).
  const prose = bots.last().locator('.dk-prose-card', { hasText: 'Lightning Bolt' });
  await prose.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await prose.click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  await page.locator('#carouselClose').click();

  // Il + mette la carta nel mazzo.
  await rows.filter({ hasText: 'Lightning Bolt' }).locator('.dk-add').click();
  await expect(page.locator('#deckList')).toContainText('Lightning Bolt');
  await expect(rows.filter({ hasText: 'Lightning Bolt' }).locator('.dk-add')).toHaveAttribute('data-in', '1');

  // La conversazione prosegue: il modello riceve lo storico di prima della ricarica.
  await ask(page, 'e adesso?');
  const last = await app.evaluate(() => globalThis.__chatCalls.at(-1).map((m) => `${m.role}:${m.content}`));
  expect(last.slice(1)).toEqual([
    'user:modi per dare haste',
    'assistant:Per la fretta guarda [[Lightning Bolt]].',
    'user:altre carte con haste',
    'assistant:Per la fretta guarda [[Lightning Bolt]].',
    'user:e adesso?',
  ]);
});

test('i tasti + e ✓ seguono il mazzo di adesso, non quello del momento della ricerca', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'haste');
  const bolt = page.locator('.dk-msg-bot').last().locator('.dk-row', { hasText: 'Lightning Bolt' }).locator('.dk-add');
  await bolt.click();
  await expect(bolt).toHaveAttribute('data-in', '1');

  // La carta esce dal mazzo per un'altra strada, poi si ricarica.
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const { deck } = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const next = window.SN_DECKS.removeCard(deck, 'bolt-1').deck;
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck: next });
  }, deckId);
  await reloadBuilder(page);
  await expect(bolt).toHaveAttribute('data-in', '0');
  await expect(bolt).toHaveText('+');
});

test('due mazzi, due conversazioni', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const a = await newDeckWithCommander(page);
  await ask(page, 'domanda sul mazzo A');

  await page.click('#backToLibrary');
  const b = await newDeckWithCommander(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await expect(page.locator('#chatEmpty')).toBeVisible();
  await ask(page, 'domanda sul mazzo B');

  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, a);
  await expect(page.locator('.dk-msg-user')).toHaveText(['domanda sul mazzo A']);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveText(['domanda sul mazzo A']);
  await expect(page.locator('.dk-msg-bot')).toContainText('Risposta a: domanda sul mazzo A');
  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, b);
  await expect(page.locator('.dk-msg-user')).toHaveText(['domanda sul mazzo B']);
});

test('svuotare la chat chiede conferma e resta vuota dopo la ricarica', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await expect(page.locator('#chatClear')).toBeHidden();
  await ask(page, 'haste');
  await expect(page.locator('#chatClear')).toBeVisible();

  // Annullare non tocca niente.
  await page.click('#chatClear');
  await clickConfirm(page, 'cancel');
  await expect(page.locator(CONFIRM_HOST)).toBeHidden();
  await expect(page.locator('.dk-msg')).toHaveCount(2);

  await page.click('#chatClear');
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await expect(page.locator('#chatEmpty')).toBeVisible();
  await expect(page.locator('#chatClear')).toBeHidden();
  await expect.poll(async () => (await savedChats(app))[deckId]).toBeUndefined();
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);

  // Stessa cosa dal menu del mazzo e col tasto destro sull'intestazione della chat.
  await ask(page, 'di nuovo');
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Svuota la chat' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await ask(page, 'ancora');
  await page.locator('#chatHead').click({ button: 'right' });
  await page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Svuota la chat' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
});

test('la copia di un mazzo parte con la chat vuota; eliminato il mazzo, la sua chat sparisce dai dati', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'haste');
  await expect.poll(async () => Boolean((await savedChats(app))[deckId])).toBe(true);

  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Duplica questo mazzo' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).not.toContain(encodeURIComponent(deckId));
  await expect(page.locator('#deckNameText')).toContainText('(copia)');
  await expect(page.locator('.dk-msg')).toHaveCount(0);

  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, deckId);
  await expect(page.locator('.dk-msg-user')).toHaveText(['haste']);
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Elimina' }).click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  const saved = await savedChats(app);
  expect(saved[deckId]).toBeUndefined();
  expect(JSON.stringify(saved)).not.toContain('haste');
});

test('chiusa la pagina mentre Filo risponde: alla riapertura la risposta è «interrotta», e Riprova la rifà', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);

  await trattieni(app);
  await page.fill('#chatInput', 'domanda lasciata a metà');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toBeVisible();
  await expect.poll(async () => ((await savedChats(app))[deckId] || { messages: [] }).messages.length).toBe(2);

  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveText(['domanda lasciata a metà']);
  const bot = page.locator('.dk-msg-bot');
  await expect(bot).toContainText('Risposta interrotta');
  await expect(page.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toHaveCount(0);

  // La risposta vecchia arriva a una pagina che non c'è più: non rientra da nessuna parte.
  await libera(app);
  await page.waitForTimeout(400);
  await expect(bot).toContainText('Risposta interrotta');

  await bot.locator('[data-retry]').click();
  await expect(bot).toContainText('Risposta a: domanda lasciata a metà');
  await expect(page.locator('.dk-msg-user')).toHaveText(['domanda lasciata a metà']);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot')).toContainText('Risposta a: domanda lasciata a metà');
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
});

test('un\'altra scheda sullo stesso mazzo vede la conversazione aggiornarsi da sola', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'prima domanda');

  const shell = app.windows().find((w) => { try { return new URL(w.url()).hostname === 'shell'; } catch (_) { return false; } });
  const url = `filo://decks/decks.html#/deck/${encodeURIComponent(deckId)}`;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().filter((w) => w.url() === url || w.url().startsWith('filo://decks/')).length).toBeGreaterThan(1);
  const other = app.windows().filter((w) => w.url().startsWith('filo://decks/')).find((w) => w !== page);
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);

  await ask(page, 'seconda domanda');
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda', 'seconda domanda']);
  // E al contrario: scrive l'altra, la prima non perde niente e la vede.
  await ask(other, 'terza domanda');
  await expect(page.locator('.dk-msg-user')).toHaveText(['prima domanda', 'seconda domanda', 'terza domanda']);
});

test('chi supera il tetto di messaggi lo vede scritto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  const max = await app.evaluate(async (_e, id) => {
    const C = globalThis.SN_DECK_CHAT;
    const messages = [];
    for (let i = 0; i < C.MAX_MESSAGES; i += 2) messages.push({ who: 'user', text: `d${i}` }, { who: 'bot', reply: `r${i}` });
    await globalThis.SN_DECK_CHATS_SVC.save(id, messages);
    return C.MAX_MESSAGES;
  }, deckId);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(max / 2);
  await expect(page.locator('.dk-chat-cap')).toHaveCount(0);
  await ask(page, 'una di troppo');
  await expect(page.locator('.dk-chat-cap')).toBeVisible();
  await expect(page.locator('.dk-chat-cap')).toContainText(max.toLocaleString('it-IT'));
});

test('riavviato Filo, la chat del mazzo è ancora lì e il + funziona', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-deckchat-');
  const launch = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const openDecks = async (app, hash = '') => {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    const before = new Set(app.windows());
    await shell.evaluate((u) => window.filoShell.tabs.open(u), `filo://decks/decks.html${hash}`);
    let page = null;
    await expect.poll(() => {
      page = app.windows().find((w) => !before.has(w) && w.url().startsWith('filo://decks/')) || null;
      return Boolean(page);
    }).toBe(true);
    await page.waitForLoadState('domcontentloaded');
    return page;
  };
  let app = await launch();
  let deckId = '';
  try {
    await mockScryfall(app);
    await mockProvider(app);
    const page = await openDecks(app);
    deckId = await newDeckWithCommander(page);
    await ask(page, 'modi per dare haste');
    // Scritto davvero su disco, non solo in memoria.
    await expect.poll(() => {
      try { return JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).deckChats?.[deckId]?.messages?.length || 0; }
      catch (_) { return 0; }
    }, { timeout: 10_000 }).toBe(2);
  } finally {
    await chiudiApp(app);
  }

  app = await launch();
  try {
    await mockScryfall(app);
    const page = await openDecks(app, `#/deck/${encodeURIComponent(deckId)}`);
    await expect(page.locator('#screenBuilder')).toBeVisible();
    await expect(page.locator('.dk-msg-user')).toHaveText(['modi per dare haste']);
    const rows = page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row');
    await expect(rows.locator('.dk-row-name')).toHaveText(['Lightning Bolt', 'Embercleave Crasher']);
    await rows.filter({ hasText: 'Lightning Bolt' }).locator('.dk-add').click();
    await expect(page.locator('#deckList')).toContainText('Lightning Bolt');
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
