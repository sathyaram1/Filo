// Verifica #792, giro 1, rilievo 1: la risposta in attesa si ferma anche col tasto destro sulla chat.
import { test, expect } from '../../fixtures/electron.mjs';

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


test('tasto destro sulla chat in attesa offre di fermare la risposta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const { page } = await openBuilder(app, openTab);
  await app.evaluate(() => { globalThis.__modelloMuto = true; });
  await scrivi(page, 'draghi rossi');
  const bot = page.locator('.dk-msg-bot').last();
  await expect(bot.locator('.dk-msg-pending', { hasText: 'sta pensando' })).toBeVisible();
  await bot.click({ button: 'right' });
  const voce = page.locator('.dk-ctxmenu .sn-select-option', { hasText: /Ferma/ });
  if (!(await voce.count())) {
    await page.locator('#chatHead').click({ button: 'right' });
  }
  await expect(voce).toHaveCount(1);
  await voce.click();
  await expect(bot.locator('.dk-msg-pending')).toHaveText('Risposta fermata.');
});
