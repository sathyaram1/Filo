// Stress test avversariale della chat unificata del Builder (task 5, verifica
// #289.5): input limite, XSS, provider che fallisce o risponde spazzatura,
// invii rapidi in sequenza. Provider LLM e Scryfall mockati come in
// decks-chat.spec.mjs; il cammino IPC della pagina è reale.

import { test, expect } from './fixtures/electron.mjs';

async function mockScryfall(app, { emptySearch = false } = {}) {
  // NB: in ElectronApplication.evaluate il PRIMO parametro è il modulo
  // electron; l'argomento passato arriva come secondo.
  await app.evaluate((_electron, { emptySearch }) => {
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
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        body = emptySearch ? { object: 'error', code: 'not_found' } : { data: [BOLT], has_more: false };
        if (emptySearch) return { ok: false, status: 404, json: async () => body };
      } else if (u.pathname === '/cards/named') body = BOLT;
      else if (u.pathname === '/cards/niv-1') body = COMMANDER;
      else if (u.pathname === '/cards/bolt-1') body = BOLT;
      else if (u.pathname === '/symbology') body = { data: [
        { symbol: '{U}', svg_uri: 'https://svgs.test/U.svg' },
        { symbol: '{R}', svg_uri: 'https://svgs.test/R.svg' },
      ] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, { emptySearch });
}

// Provider programmabile: la risposta è decisa dal test via __nextReply;
// se __failNext è armato, il provider lancia (simula 429/rete giù).
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
    globalThis.__nextReply = JSON.stringify({ reply: 'ok' });
    globalThis.__failNext = false;
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      if (globalThis.__failNext) { globalThis.__failNext = false; throw new Error('provider giù'); }
      await new Promise((r) => setTimeout(r, 50));
      return { text: String(globalThis.__nextReply), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    // La chat dei mazzi chiede il reasoning → cammino streaming: delega al
    // mock non-streaming qui sopra (nessun chunk di CoT in questi test).
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

async function setReply(app, value) {
  await app.evaluate((_electron, v) => { globalThis.__nextReply = v; }, value);
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
  expect(r && r.ok).toBe(true);
  return deckId;
}

test('XSS: reply e query ostili restano testo, nessuno script esegue', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.evaluate(() => { window.__xss = false; });
  // Reply con script + marcatore carta ostile + query con payload onerror.
  await setReply(app, JSON.stringify({
    reply: '<script>window.__xss=true<\/script> guarda [[<img src=x onerror=window.__xss=true>]] "quote"',
    query: '"><img src=x onerror=window.__xss=true>',
  }));
  await page.fill('#chatInput', 'attacco');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(1);
  // Il testo ostile è visibile COME TESTO (successo: escapato, non eseguito).
  await expect(bubble.locator('.dk-msg-text')).toContainText('<script>');
  expect(await page.evaluate(() => window.__xss)).toBe(false);
  expect(await page.locator('#chatLog img[src="x"]').count()).toBe(0);
  // Anche il marcatore [[...]] ostile è reso span con testo escapato.
  await expect(bubble.locator('.dk-prose-card')).toContainText('<img');
});

test('input vuoto/spazi non parte; 10k caratteri e doppio invio rapido non rompono', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Solo spazi → nessuna bolla, nessuna chiamata al provider.
  await page.fill('#chatInput', '   ');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__chatCalls.length)).toBe(0);

  // Doppio invio rapido mentre il provider "pensa": parte UN solo scambio.
  await setReply(app, JSON.stringify({ reply: 'prima risposta' }));
  await page.fill('#chatInput', 'primo');
  await page.press('#chatInput', 'Enter');
  await page.fill('#chatInput', 'secondo (mentre pensa)');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('prima risposta');
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  expect(await app.evaluate(() => globalThis.__chatCalls.length)).toBe(1);

  // 10.000 caratteri: la chat risponde e la bolla utente non rompe il layout.
  await setReply(app, JSON.stringify({ reply: 'letto tutto' }));
  await page.fill('#chatInput', 'x'.repeat(10_000));
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot').last()).toContainText('letto tutto');
  const overflow = await page.evaluate(() => {
    const log = document.getElementById('chatLog');
    return log.scrollWidth - log.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(2);
});

test('provider giù → bolla d\'errore e la chat resta usabile; JSON malformato degrada a prosa', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Provider che lancia: la bolla mostra un errore, non resta "sta pensando".
  await app.evaluate(() => { globalThis.__failNext = true; });
  await page.fill('#chatInput', 'ciao');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-error')).toHaveCount(1);
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0);

  // La chat NON è bloccata: il turno dopo funziona.
  await setReply(app, 'testo libero senza JSON, cita [[Lightning Bolt]]');
  await page.fill('#chatInput', 'riprova');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText('testo libero senza JSON');
  await expect(bubble.locator('.dk-prose-card')).toHaveText('Lightning Bolt');
  await expect(bubble.locator('.dk-cardlist')).toHaveCount(0);
});

test('ricerca senza risultati → messaggio "nessun risultato", niente lista fantasma', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app, { emptySearch: true });
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await setReply(app, JSON.stringify({ query: 't:sliver o:banding' }));
  await page.fill('#chatInput', 'sliver con banding');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('.dk-cardlist .dk-row')).toHaveCount(0);
  // Deve dire chiaramente che non c'è nulla (o errore garbato), non lista vuota muta.
  await expect(bubble).toContainText(/nessun risultato|non ha funzionato/i);
});
