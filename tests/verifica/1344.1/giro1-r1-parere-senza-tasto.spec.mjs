// Verifica #1344.1, giro 1, rilievo 1: il parere mancato manda in una pagina che l'utente non ha, senza il tasto.
import { test, expect } from '../../fixtures/electron.mjs';


async function scryfallFinto(app) {
  await app.evaluate(() => {
    const carta = (id, name, extra) => ({
      id, name, cmc: 1, type_line: 'Instant', oracle_text: 'Testo.', colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg` }, prices: { eur: '1.00' }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${id}`, mana_cost: '{R}', ...extra,
    });
    const BY_ID = {
      'niv-1': carta('niv-1', 'Niv-Mizzet, Parun', { type_line: 'Legendary Creature — Dragon Wizard', cmc: 6, colors: ['U', 'R'], color_identity: ['U', 'R'] }),
      'bolt-1': carta('bolt-1', 'Lightning Bolt'),
      'tome-1': carta('tome-1', 'Faithless Looting', { type_line: 'Sorcery' }),
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        body = u.searchParams.get('unique') === 'prints' ? { total_cards: 3, data: [] } : { data: [BY_ID['bolt-1'], BY_ID['tome-1']], has_more: false };
      } else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// `__parere`: 'salta' risponde senza pareri, '402' crediti finiti, 'rete' nessuna risposta HTTP.
async function modelloDeiMazzi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.DECKS_OPINION]: 'deepseek-flash',
        [C.ACTIONS.DECKS_AUTOTAG]: 'deepseek-flash', [C.ACTIONS.DECKS_SEARCH_FILTER]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__pareri = 0;
    globalThis.__parere = 'salta';
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      if (tutto.includes('CARTE DA VALUTARE')) {
        globalThis.__pareri += 1;
        if (globalThis.__parere === '402') {
          const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
          e.status = 402; e.provider = 'openrouter';
          throw e;
        }
        if (globalThis.__parere === 'rete') {
          const e = new TypeError('fetch failed');
          e.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND openrouter.ai' };
          throw e;
        }
        return fatto(JSON.stringify({ pareri: [] }));
      }
      if (tutto.includes('CARTE CANDIDATE')) return fatto('{"keep":[1,2]}');
      return fatto(JSON.stringify({ reply: 'Ecco.', query: 'c:r' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  });
}

async function mazzoConCarta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  await page.fill('#chatInput', 'carte rosse che pescano');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla.locator('.dk-cardlist .dk-row')).toHaveCount(2, { timeout: 20_000 });
  await bolla.locator('[data-add="bolt-1"]').click();
  const riga = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
  await expect(riga).toBeVisible();
  return { riga, bolla };
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
  .map((t) => t.view.webContents.getURL()));

test('r1 il modello salta la carta: il riquadro manda dove l’utente cambia il modello, col tasto', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  const { riga } = await mazzoConCarta(page);
  await riga.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await riga.hover();
  const modulo = page.locator('#previewModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 15_000 });
  // «Modelli predefiniti» è una scheda della Gestione: chi usa Filo non ce l'ha.
  await expect(modulo.locator('.dk-op-errore')).not.toContainText('Modelli predefiniti');
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Opzioni');
  await modulo.locator('.dk-rimedio').click();
  await expect.poll(async () => (await schede(app)).some((u) => u.startsWith('filo://options')), { timeout: 15_000 }).toBe(true);
});
