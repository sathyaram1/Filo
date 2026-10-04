// #789 giro 2: lista incollata insieme alla richiesta esplicita di sostituire il commander; avviso di una carta sola.
import { test, expect } from '../../fixtures/electron.mjs';

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
      else if (u.pathname === '/cards/named') {
        const q = String(u.searchParams.get('fuzzy') || u.searchParams.get('exact') || '').toLowerCase();
        body = Object.values(BY_ID).find((c) => c.name.toLowerCase() === q) || NIV;
      }
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
      const text = /lista nuova/i.test(last)
        ? JSON.stringify({ reply: 'Ok.', commander: 'Niv-Mizzet, Parun', replaceCommander: true, import: [{ name: 'Llanowar Elves', qty: 1 }] })
        : /sostituisci senza ricerca/i.test(last)
        ? JSON.stringify({ reply: 'Fatto.', commander: 'Niv-Mizzet, Parun', replaceCommander: true })
        : /^is:commander/.test(last)
        ? JSON.stringify({ query: 'is:commander' })
        : /consigliami/i.test(last)
          ? JSON.stringify({ reply: 'Prova [[Niv-Mizzet, Parun]].' })
          : /incollo/i.test(last)
            ? JSON.stringify({ commander: 'Niv-Mizzet, Parun', import: [{ name: 'Llanowar Elves', qty: 1 }] })
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

test('lista incollata con «sostituisci il commander»: Aggiungi tutte cambia il commander e rimette il vecchio nel mazzo', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await mockScryfall(app); await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  const deckId = await newDeck(page);
  await seed(page, deckId, { commander: 'bolt-1' });
  await page.fill('#chatInput', 'ecco la mia lista nuova, sostituisci il commander con Niv: 1 Llanowar Elves');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('[data-import-all]')).toBeVisible();
  await bubble.locator('[data-import-all]').click();
  await expect(page.locator('#commanderLine')).toContainText('Niv-Mizzet, Parun');
  const deck = await getDeck(page, deckId);
  expect(deck.commander).toBe('niv-1');
  expect(deck.carte.map((c) => c.scryfall_id).sort()).toEqual(['bolt-1', 'elf-1']);
});
