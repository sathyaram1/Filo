// Verifica #791 giro 2, rilievo 1: in chat una mano da tenere detta senza il numero di mulligan non deve sparire in silenzio.
import { test, expect } from '../../fixtures/electron.mjs';

const CARDS = {
  'c-bolt': { id: 'c-bolt', name: 'Lightning Bolt', mana_cost: '{R}', cmc: 1, type_line: 'Instant', colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/bolt.jpg' }, prices: { eur: '1.50' }, legalities: { commander: 'legal' } },
  'c-dragon': { id: 'c-dragon', name: 'Shivan Dragon', mana_cost: '{4}{R}{R}', cmc: 6, type_line: 'Creature — Dragon', colors: ['R'], color_identity: ['R'], image_uris: { normal: 'https://cards.test/dragon.jpg' }, prices: { eur: '0.90' }, legalities: { commander: 'legal' } },
  'c-mountain': { id: 'c-mountain', name: 'Mountain', mana_cost: '', cmc: 0, type_line: 'Basic Land — Mountain', colors: [], color_identity: ['R'], produced_mana: ['R'], image_uris: { normal: 'https://cards.test/mountain.jpg' }, prices: { eur: '0.10' }, legalities: { commander: 'legal' } },
};

async function mock(app) {
  await app.evaluate(async (_e, cardsJson) => {
    const CARDS = JSON.parse(cardsJson);
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const m = /^\/cards\/([^/]+)$/.exec(new URL(String(url)).pathname);
      const body = m && CARDS[m[1]];
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
    });
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    // «se faccio mulligan delle mani con meno di 3 terre»: il modello compila la mano da tenere ma non quante volte.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: JSON.stringify({ reply: '', prob: { turn: 3, needs: { terre: 3 }, keep: { terre: 3 } } }),
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (o) => {
      const r = await globalThis.SN_PROVIDERS.completeWithFallback(o);
      if (o.onDelta) o.onDelta(r.text);
      return r;
    };
  }, JSON.stringify(CARDS));
}

test('r1 in chat una mano da tenere senza numero di mulligan viene contata o la risposta lo dice', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mock(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (id) => {
    const { MSG } = window.SN_MSG;
    const r = await chrome.runtime.sendMessage({ type: MSG.DECKS_GET, id });
    const deck = r.deck;
    deck.carte = [
      { scryfall_id: 'c-mountain', qty: 40 },
      { scryfall_id: 'c-bolt', qty: 30 },
      { scryfall_id: 'c-dragon', qty: 29 },
    ];
    await chrome.runtime.sendMessage({ type: MSG.DECKS_UPDATE, deck });
  }, deckId);
  await page.evaluate(() => location.reload());
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#probNeeds input[data-tag="terre"]')).toBeVisible();

  await page.fill('#chatInput', 'che probabilità ho di avere 3 terre al turno 3 se faccio mulligan delle mani con meno di 3 terre?');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Probabilità di avere 3 terre al turno 3');
  // La condizione detta dall'utente compare nella risposta: contata, o dichiarata non contata.
  await expect(bolla).toContainText(/mulligan/i);
});
