// Verifica #791 giro 1: calcolatore di probabilità con partita, mulligan e pescate extra.
import { test, expect } from '../../fixtures/electron.mjs';

const CARDS = {
  'c-bolt': { id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, type_line: 'Instant', colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/bolt.jpg' }, prices: { eur: '1.50' }, legalities: { commander: 'legal' } },
  'c-dragon': { id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6, type_line: 'Creature — Dragon', colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/dragon.jpg' }, prices: { eur: '0.90' }, legalities: { commander: 'legal' } },
  'c-mountain': { id: 'c-mountain', name: 'Mountain', mana_cost: '', cmc: 0, type_line: 'Basic Land — Mountain', colors: [], color_identity: ['R'], produced_mana: ['R'], image_uris: { normal: 'https://cards.test/mountain.jpg' }, prices: { eur: '0.10' }, legalities: { commander: 'legal' } },
};

async function mockScryfall(app) {
  await app.evaluate((electron, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
      const body = m && CARDS[m[1]] ? CARDS[m[1]] : (u.pathname === '/symbology' ? { data: [] } : null);
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  }, JSON.stringify(CARDS));
}

// «con due mulligan»: il modello compila i mulligan ma non dice che mano tenere.
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
      text: JSON.stringify({ reply: '', prob: { turn: 3, needs: { terre: 3 }, mulligans: 2 } }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
    };
  });
}

async function seedBigDeck(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const id = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (deckId) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id: deckId });
    const deck = r.deck;
    deck.carte = [
      { scryfall_id: 'c-mountain', qty: 38 },
      { scryfall_id: 'c-bolt', qty: 31, tags: ['rimozione'] },
      { scryfall_id: 'c-dragon', qty: 30, tags: ['minaccia'] },
    ];
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, id);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#probNeeds input[data-tag="terre"]')).toBeVisible();
}

test('r1 in chat un mulligan senza mano da tenere non sparisce in silenzio: il riquadro parte da 2 terre', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  await mockProvider(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedBigDeck(page);
  await page.fill('#chatInput', 'che probabilità ho di avere 3 terre al turno 3 con due mulligan?');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Probabilità di avere 3 terre al turno 3');
  await expect(bolla).toContainText(/mulligan/);
});

test('aspetto e raffiche: riquadro col mulligan in chiaro e scuro, valori strani', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await mockScryfall(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await seedBigDeck(page);
  const result = page.locator('#probResult');
  await page.locator('#probNeeds input[data-tag="terre"]').fill('3');
  for (const v of ['1', '0', '3', '', '-2', '99', '1']) await page.fill('#probMull', v);
  await page.fill('#probExtra', 'abc');
  await expect(result).toHaveText(/≈ \d/);
  await expect(result).not.toHaveClass(/dk-prob-refining/, { timeout: 30_000 });
  await expect(page.locator('#probNeeds input[data-keep="terre"]')).toHaveValue('2');
  await page.screenshot({ path: 'tests/.shots/v791-chiaro.png' });
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.click('#probGame');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v791-scuro.png' });
});
