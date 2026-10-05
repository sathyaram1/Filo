// Chat del banco di lavoro dei mazzi: una risposta che non arriva non blocca più la chat (#792). Si vede da quanto si
// aspetta, «Ferma» (o Esc nel campo) annulla davvero la richiesta al modello e la chat riparte; se Scryfall non
// risponde la richiesta si chiude entro il tempo limite con una frase, e le richieste dopo non restano in coda.
// Modello e Scryfall sono finti nel main; i messaggi viaggiano sul cammino IPC vero della pagina.

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app) {
  await app.evaluate(() => {
    const card = (id, name, cost, cmc, type, ci) => ({
      id, name, mana_cost: cost, cmc, type_line: type, colors: ci, color_identity: ci,
      image_uris: { normal: `https://cards.test/${id}.jpg`, art_crop: `https://cards.test/${id}-art.jpg` },
      prices: { eur: '1.00' }, legalities: { commander: 'legal' }, scryfall_uri: `https://scryfall.com/card/${id}`,
    });
    const COMMANDER = card('niv-1', 'Niv-Mizzet, Parun', '{U}{U}{U}{R}{R}{R}', 6, 'Legendary Creature — Dragon Wizard', ['U', 'R']);
    const BOLT = card('bolt-1', 'Lightning Bolt', '{R}', 1, 'Instant', ['R']);
    const BY_ID = { 'niv-1': COMMANDER, 'bolt-1': BOLT };
    // `__ricercaAppesa`: la ricerca non risponde (e si chiude solo se chi aspetta la ferma o scade il tempo limite).
    globalThis.__ricercaAppesa = false;
    globalThis.__richiesteScryfall = [];
    globalThis.SN_SCRYFALL._setFetch(async (url, opts) => {
      const u = new URL(String(url));
      globalThis.__richiesteScryfall.push(u.pathname);
      if (u.pathname === '/cards/search' && globalThis.__ricercaAppesa) {
        return new Promise((_, reject) => {
          const s = opts && opts.signal;
          if (s) s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      }
      let body = null;
      if (u.pathname === '/cards/search') body = { data: [BOLT], has_more: false, total_cards: 1 };
      else if (u.pathname === '/cards/named') body = /niv/i.test(u.searchParams.get('fuzzy') || '') ? COMMANDER : BOLT;
      else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [{ symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' }] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// `__modelloMuto`: il modello non risponde mai; si chiude solo se la richiesta viene annullata, e lo registra.
// `__risposta`: il JSON che il modello dà quando risponde.
async function mockProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__modelloMuto = false;
    globalThis.__annullate = 0;
    globalThis.__chiamate = 0;
    globalThis.__risposta = null;
    const rispondi = async ({ attempts, messages, signal, onReasoning }) => {
      const prompt = String(messages[messages.length - 1].content || '');
      if (/CARTE CANDIDATE/.test(prompt)) {
        const keep = (prompt.match(/^\d+(?=\. )/gm) || []).map(Number);
        return { text: JSON.stringify({ keep }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      globalThis.__chiamate += 1;
      try { onReasoning && onReasoning('Penso ai colori del commander.'); } catch (_) {}
      if (globalThis.__modelloMuto) {
        await new Promise((_, reject) => {
          const fine = () => { globalThis.__annullate += 1; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); };
          if (!signal) return;
          if (signal.aborted) fine(); else signal.addEventListener('abort', fine, { once: true });
        });
      }
      const text = globalThis.__risposta || JSON.stringify({ reply: `Risposta a: ${prompt}` });
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const r = await rispondi(args);
      if (args.onDelta) args.onDelta(r.text);
      return r;
    };
  });
}

async function openBuilder(app, openTab) {
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  return { page, deckId };
}

async function scrivi(page, text) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
}

const deckIn = (app, id) => app.evaluate((_e, deckId) => globalThis.SN_DECK_STORE.get(deckId), id);

test('modello che non risponde: si vede l\'attesa, «Ferma» annulla davvero la richiesta e la chat riparte', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const { page } = await openBuilder(app, openTab);
  await app.evaluate(() => { globalThis.__modelloMuto = true; });

  await scrivi(page, 'draghi rossi');
  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toBeVisible();
  await expect(page.locator('#chatStop')).toBeVisible();
  // Il tempo dell'attesa cammina.
  await expect(page.locator('#chatWaitTime')).toHaveText(/^0:0[2-9]$/, { timeout: 10_000 });

  // Invio con la chat occupata: il messaggio non parte e non si perde.
  await scrivi(page, 'e poi?');
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  await expect(page.locator('#chatInput')).toHaveValue('e poi?');

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.locator('#colChat').screenshot({ path: `tests/.shots/decks-chat-stop-attesa-${tema}.png` }).catch(() => {});
  }

  await page.click('#chatStop');
  await expect(bot.locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
  await expect(bot.locator('[data-retry]')).toBeVisible();
  await expect(page.locator('#chatStop')).toBeHidden();
  await expect.poll(() => app.evaluate(() => globalThis.__annullate)).toBe(1);
  await expect(page.locator('#chatInput')).toBeFocused();

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), tema);
    await page.locator('#colChat').screenshot({ path: `tests/.shots/decks-chat-stop-fermata-${tema}.png` }).catch(() => {});
  }

  // Il messaggio dopo parte normalmente e riceve risposta.
  await app.evaluate(() => { globalThis.__modelloMuto = false; });
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-user')).toHaveText(['draghi rossi', 'e poi?']);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-text')).toContainText('Risposta a: e poi?');
  await expect(page.locator('#chatStop')).toBeHidden();

  // Riaperta la pagina, la bolla fermata resta detta così.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dk-msg-bot').first().locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
});

test('Esc col cursore nel campo ferma come il tasto, e «Riprova» rifà la domanda', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const { page } = await openBuilder(app, openTab);
  await app.evaluate(() => { globalThis.__modelloMuto = true; });
  await scrivi(page, 'carte blu');
  await expect(page.locator('#chatStop')).toBeVisible();
  await page.press('#chatInput', 'Escape');
  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
  await expect.poll(() => app.evaluate(() => globalThis.__annullate)).toBe(1);

  await app.evaluate(() => { globalThis.__modelloMuto = false; });
  await bot.locator('[data-retry]').click();
  await expect(page.locator('.dk-msg-user')).toHaveText(['carte blu']);
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-text')).toContainText('Risposta a: carte blu');
});

test('tasto destro sulla bolla in attesa o sull\'intestazione della chat: «Ferma la risposta» ferma come il tasto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const { page } = await openBuilder(app, openTab);
  await app.evaluate(() => { globalThis.__modelloMuto = true; });
  const voce = page.locator('.dk-ctxmenu .sn-select-option', { hasText: 'Ferma la risposta' });

  await scrivi(page, 'draghi rossi');
  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toBeVisible();
  await bot.click({ button: 'right' });
  await voce.click();
  await expect(bot.locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
  await expect.poll(() => app.evaluate(() => globalThis.__annullate)).toBe(1);
  // A chat libera la voce non c'è più, nemmeno sulla bolla fermata.
  await bot.click({ button: 'right' });
  await expect(voce).toHaveCount(0);

  await scrivi(page, 'carte blu');
  await expect(page.locator('#chatStop')).toBeVisible();
  await page.locator('#chatHead').click({ button: 'right' });
  await expect(page.locator('.dk-ctxmenu .sn-select-option')).toHaveText(['Ferma la risposta', 'Svuota la chat…']);
  await voce.click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
  await expect.poll(() => app.evaluate(() => globalThis.__annullate)).toBe(2);
  await page.locator('#chatHead').click({ button: 'right' });
  await expect(page.locator('.dk-ctxmenu .sn-select-option')).toHaveText(['Svuota la chat…']);
});

test('fermata a metà, il mazzo non cambia: commander e budget chiesti nel turno non si applicano', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const { page, deckId } = await openBuilder(app, openTab);
  await app.evaluate(() => {
    globalThis.SN_SCRYFALL._setTimeoutMs(60_000);
    globalThis.__ricercaAppesa = true;
    globalThis.__risposta = JSON.stringify({ reply: 'Imposto Niv e il budget, poi cerco.', commander: 'Niv-Mizzet, Parun', budget: 40, query: 'o:haste' });
  });
  await scrivi(page, 'niv-mizzet commander, budget 40, carte con haste');
  await expect.poll(() => app.evaluate(() => globalThis.__richiesteScryfall.includes('/cards/search'))).toBe(true);
  await page.click('#chatStop');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
  // Un attimo per una scrittura che non deve arrivare.
  await page.waitForTimeout(500);
  const deck = await deckIn(app, deckId);
  expect(deck.commander || '').toBe('');
  expect(deck.budget).toBeNull();
  await expect(page.locator('#commanderLine')).toContainText('Nessun commander');
  await app.evaluate(() => { globalThis.SN_SCRYFALL._setTimeoutMs(0); });
});

test('Scryfall che non risponde: entro il tempo limite una frase, e intanto anteprime e ricerche dopo funzionano', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const { page } = await openBuilder(app, openTab);
  await app.evaluate(() => {
    globalThis.SN_SCRYFALL._setTimeoutMs(4000);
    globalThis.__ricercaAppesa = true;
    globalThis.__risposta = JSON.stringify({ reply: 'Cerco le carte con haste.', query: 'o:haste' });
  });
  await scrivi(page, 'o:haste');
  await expect.poll(() => app.evaluate(() => globalThis.__richiesteScryfall.includes('/cards/search'))).toBe(true);

  // Con la ricerca appesa, un'anteprima (nome → carta) risponde subito: non è in coda dietro di lei.
  const t = await page.evaluate(async () => {
    const t0 = Date.now();
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.SCRYFALL_NAMED, name: 'Lightning Bolt' });
    return { ms: Date.now() - t0, name: r && r.card && r.card.name };
  });
  expect(t.name).toBe('Lightning Bolt');
  expect(t.ms).toBeLessThan(2000);

  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-msg-text')).toContainText(
    'La ricerca non è arrivata: Scryfall, l\'archivio delle carte, non ha risposto entro 4 secondi. Riprova tra poco.', { timeout: 15_000 });
  await expect(bot.locator('.dk-msg-text')).not.toContainText(/\d{4,}|ms\b|TIMEOUT/);
  await expect(bot.locator('[data-retry]')).toBeVisible();
  await expect(page.locator('#chatStop')).toBeHidden();

  // Scryfall è tornato: la ricerca dopo funziona.
  await app.evaluate(() => { globalThis.__ricercaAppesa = false; });
  await bot.locator('[data-retry]').click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cardlist .dk-row-name')).toHaveText(['Lightning Bolt']);
  await app.evaluate(() => { globalThis.SN_SCRYFALL._setTimeoutMs(0); });
});
