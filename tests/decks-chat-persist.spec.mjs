// La chat del banco di lavoro di un mazzo resta dopo una ricarica e dopo un riavvio di Filo, mazzo per mazzo (#787).
// Provider e Scryfall sono finti nel main; i messaggi viaggiano sul cammino IPC vero della pagina. Si asserisce quello
// che vede l'utente: bolle e liste di nuovo lì, il + che mette la carta nel mazzo, lo storico che arriva al modello.

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clickConfirm, CONFIRM_HOST } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

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
      // Il giudice dei risultati (#382) le tiene tutte: qui si prova la chat, non il filtro.
      const prompt = String(messages[messages.length - 1].content || '');
      if (/CARTE CANDIDATE/.test(prompt)) {
        const keep = (prompt.match(/^\d+(?=\. )/gm) || []).map(Number);
        return { text: JSON.stringify({ keep }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
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

// Come il + delle righe, anche «Aggiungi tutte» di una lista incollata segue il mazzo di adesso: tolte le carte e
// riaperta la chat torna usabile e le rimette nel mazzo.
test('«Aggiungi tutte» di una lista incollata segue il mazzo di adesso, anche dopo la ricarica', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/importa/i.test(last)) return prev(args);
      const text = JSON.stringify({ reply: 'Ecco la lista.', import: [{ name: 'Lightning Bolt', qty: 1 }] });
      return { text, model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  await ask(page, 'importa questa lista: 1 Lightning Bolt');
  const all = page.locator('.dk-import-all');
  await all.click();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
  await expect(all).toBeDisabled();
  await expect(all).toHaveText('Aggiunte ✓');

  // Tolta la carta, il tasto torna acceso subito, e resta acceso dopo la ricarica.
  await page.locator('.dk-msg-bot [data-add="bolt-1"]').click();
  await expect(page.locator('#deckCount')).toHaveText('0/100 carte');
  await expect(all).toBeEnabled();
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot [data-add="bolt-1"]')).toHaveAttribute('data-in', '0');
  await expect(all).toBeEnabled();
  await expect(all).toHaveText('Aggiungi tutte al mazzo');
  await all.click();
  await expect(page.locator('#deckCount')).toHaveText('1/100 carte');
  await expect(all).toBeDisabled();
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

test('un\'altra scheda sullo stesso mazzo vede la conversazione aggiornarsi da sola', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await newDeckWithCommander(page);
  await ask(page, 'prima domanda');

  // La pagina dei mazzi è una scheda sola: la seconda si ottiene con «Duplica scheda».
  const before = new Set(app.windows());
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.duplicate(snap.activeId);
  });
  let other = null;
  await expect.poll(() => {
    other = app.windows().find((w) => !before.has(w) && w.url().startsWith('filo://decks/')) || null;
    return Boolean(other);
  }).toBe(true);
  await other.waitForLoadState('domcontentloaded');
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
    await globalThis.SN_DECK_CHATS_SVC.edit(id, { op: 'append', messages });
    return C.MAX_MESSAGES;
  }, deckId);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(max / 2);
  await expect(page.locator('.dk-chat-cap')).toHaveCount(0);
  await ask(page, 'una di troppo');
  await expect(page.locator('.dk-chat-cap')).toBeVisible();
  const scritto = await page.evaluate((n) => n.toLocaleString('it-IT', { useGrouping: true }), max);
  await expect(page.locator('.dk-chat-cap')).toContainText(scritto);
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
    const shell = await primaFinestra(app);
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

async function secondaScheda(app, shell) {
  const before = new Set(app.windows());
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    await window.filoShell.tabs.duplicate(snap.activeId);
  });
  let other = null;
  await expect.poll(() => {
    other = app.windows().find((w) => !before.has(w) && w.url().startsWith('filo://decks/')) || null;
    return Boolean(other);
  }).toBe(true);
  await other.waitForLoadState('domcontentloaded');
  return other;
}

// Due schede sullo stesso mazzo: quella che non aspetta vede Filo pensare (non «interrotta»), una chat svuotata lì
// resta vuota quando la risposta dell'altra arriva, e solo se la scheda che aspetta si ricarica la risposta è interrotta.
test('due schede sullo stesso mazzo mentre Filo risponde in una: pensa, svuotata resta vuota, ricaricata è interrotta', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'prima domanda');
  const other = await secondaScheda(app, shell);
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda']);

  await trattieni(app);
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(other.locator('.dk-msg-user')).toHaveText(['prima domanda', 'creature con haste']);
  await expect(other.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await expect(other.locator('.dk-retry')).toHaveCount(0);
  await libera(app);
  await expect(other.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2);

  await trattieni(app);
  await page.fill('#chatInput', 'e adesso?');
  await page.press('#chatInput', 'Enter');
  await expect(other.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await other.click('#chatClear');
  await clickConfirm(other, 'ok');
  await expect(other.locator('.dk-msg')).toHaveCount(0);
  await libera(app);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await other.waitForTimeout(500);
  await expect(other.locator('.dk-msg')).toHaveCount(0);
  expect((await savedChats(app))[deckId]).toBeUndefined();

  await ask(other, 'ripartiamo');
  await expect(page.locator('.dk-msg-user')).toHaveText(['ripartiamo']);
  await trattieni(app);
  await page.fill('#chatInput', 'ancora');
  await page.press('#chatInput', 'Enter');
  await expect(other.locator('.dk-msg-bot').last()).toContainText('sta pensando');
  await page.reload();
  await expect(other.locator('.dk-msg-bot').last()).toContainText('interrotta');
  await expect(other.locator('.dk-retry')).toHaveCount(1);
  await libera(app);
});

// Una chat salvata cresce di sessione in sessione: mille messaggi, sotto il tetto, e il ragionamento in diretta non
// deve ridisegnare tutta la conversazione a ogni pezzo.
test('su una chat salvata lunga il ragionamento in diretta non blocca la pagina', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mockScryfall(app);
  await mockProvider(app);
  await app.evaluate(() => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 75));
        try { args.onReasoning && args.onReasoning(`pezzo ${i} `); } catch (_) {}
      }
      return prev(args);
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await app.evaluate(async (_e, id) => {
    const messages = [];
    for (let i = 0; i < 500; i += 1) {
      messages.push({ who: 'user', text: `domanda ${i}` });
      messages.push({ who: 'bot', reply: `risposta ${i} con [[Lightning Bolt]]`, reasoning: 'r'.repeat(1500), cardIds: ['bolt-1', 'crasher-1'], query: 'o:haste', turn: `t${i}` });
    }
    await globalThis.SN_DECK_CHATS_SVC.edit(id, { op: 'append', messages });
  }, deckId);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-user')).toHaveCount(500);
  await page.evaluate(() => {
    window.__lunghi = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lunghi.push(e.duration); }).observe({ type: 'longtask' });
  });
  await page.fill('#chatInput', 'creature con haste');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toContainText('pezzo 10');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row')).toHaveCount(2, { timeout: 30_000 });
  const bloccata = await page.evaluate(() => window.__lunghi.reduce((a, b) => a + b, 0));
  expect(bloccata).toBeLessThan(300);
  // Aprire una lista vecchia rifà solo quella bolla.
  const ms = await page.evaluate(() => {
    const t = performance.now();
    document.querySelectorAll('[data-toggle-list]')[3].click();
    return performance.now() - t;
  });
  expect(ms).toBeLessThan(60);
  await expect(page.locator('.dk-msg-bot').nth(3).locator('.dk-cardlist .dk-row')).toHaveCount(2);
});

// «Svuota la chat» scritto in chat fa la stessa cosa della gomma: il modello sa che si può, la pagina chiede conferma.
async function modelloCheSvuota(app, attesaMs = 0) {
  await app.evaluate((_e, attesaMs) => {
    const prev = globalThis.SN_PROVIDERS.completeWithFallback;
    globalThis.SN_PROVIDERS.completeWithFallback = async (args) => {
      const last = String(args.messages[args.messages.length - 1].content || '');
      if (!/svuota/i.test(last)) return prev(args);
      globalThis.__chatCalls.push(args.messages);
      if (attesaMs) await new Promise((r) => setTimeout(r, attesaMs));
      // Il modello dice di averla già svuotata: la bolla non deve crederci.
      return { text: '{"clearChat": true, "reply": "Fatto, chat svuotata!"}', model: args.attempts[0].model, provider: args.attempts[0].provider, usage: {} };
    };
  }, attesaMs);
}

test('«svuota la chat» scritto in chat chiede conferma e la svuota, anche dopo la ricarica', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await modelloCheSvuota(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'creature con haste');

  await page.fill('#chatInput', 'svuota la chat');
  await page.press('#chatInput', 'Enter');
  await clickConfirm(page, 'cancel');
  await expect(page.locator('.dk-msg-user')).toHaveText(['creature con haste', 'svuota la chat']);
  const sistema = await app.evaluate(() => String(globalThis.__chatCalls.at(-1)[0].content));
  expect(sistema).toContain('svuota la chat');
  // Annullato: la bolla chiede, non promette né dice di aver fatto; il suo tasto resta, anche dopo la ricarica.
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Svuoto la chat di questo mazzo?');
  await expect(bolla).not.toContainText('svuotata');
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg-bot').last().locator('[data-clear-chat]')).toBeVisible();
  await page.locator('.dk-msg-bot').last().locator('[data-clear-chat]').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);

  // Chiesto di nuovo e confermato subito: la conferma si apre da sola.
  await ask(page, 'creature con haste');
  await page.fill('#chatInput', 'svuota la chat, per favore');
  await page.press('#chatInput', 'Enter');
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  expect((await savedChats(app))[deckId]).toBeUndefined();
});

test('«svuota la chat» chiesto e poi lasciato il mazzo mentre Filo risponde: al ritorno la richiesta è ancora lì', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  await modelloCheSvuota(app, 1500);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeckWithCommander(page);
  await ask(page, 'creature con haste');
  await page.fill('#chatInput', 'svuota la chat');
  await page.press('#chatInput', 'Enter');
  await page.click('#backToLibrary');
  await expect(page.locator('#screenLibrary')).toBeVisible();
  await expect.poll(async () => {
    const m = ((await savedChats(app))[deckId] || { messages: [] }).messages.at(-1);
    return !!(m && m.clearChat && !m.pending);
  }, { timeout: 10_000 }).toBe(true);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

  await page.evaluate((id) => { location.hash = `#/deck/${encodeURIComponent(id)}`; }, deckId);
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Svuoto la chat di questo mazzo?');
  await bolla.locator('[data-clear-chat]').click();
  await clickConfirm(page, 'ok');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  await reloadBuilder(page);
  await expect(page.locator('.dk-msg')).toHaveCount(0);
});
