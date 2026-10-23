// Verifica #1344.1, giro 3: le porte vicine a quelle provate dal lavoro (parere senza invito, rete assente nel
// carosello, descrizione con fornitori esclusi o senza invito, titolo dell'Editor senza modello).

import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = 'tests/.shots';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function senzaChiave(app) {
  await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({ ...orig(), apiKeys: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
  .map((t) => t.view.webContents.getURL()));
async function siApre(app, inizio) {
  await expect.poll(async () => (await schede(app)).some((u) => u.startsWith(inizio)), { timeout: 15_000 }).toBe(true);
}

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

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

// Modello finto: la chat trova due carte rosse, il giudice le tiene; il parere segue `__parere`.
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
    globalThis.__parere = 'ok';
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      if (tutto.includes('CARTE DA VALUTARE')) {
        if (globalThis.__parere === 'rete') throw Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' });
        if (globalThis.__parere === '503') throw Object.assign(new Error('OpenRouter 503: overloaded'), { status: 503 });
        return fatto(JSON.stringify({ pareri: [] }));
      }
      if (tutto.includes('CARTE CANDIDATE')) return fatto('{"keep":[1,2]}');
      return fatto(JSON.stringify({ reply: 'Ecco.', query: 'c:r' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
    const S = globalThis.SN_DECK_OPINIONS_SVC;
    globalThis.__calcoli = 0;
    const orig = S.computeOpinions;
    S.computeOpinions = async (o) => { globalThis.__calcoli += 1; return orig(o); };
  });
}
const calcoli = (app) => app.evaluate(() => globalThis.__calcoli);

async function mazzoConDueCarte(page) {
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
  await expect(page.locator('#deckList .dk-row[data-card-id="bolt-1"]')).toBeVisible();
  await bolla.locator('[data-add="tome-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="tome-1"]')).toBeVisible();
}

async function moduloParere(page) {
  const riga = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
  await riga.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await riga.hover();
}

test('parere senza invito, come nei passi della segnalazione: una richiesta, il motivo e «Apri Crediti»', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  await mazzoConDueCarte(page);
  await senzaChiave(app);
  await app.evaluate(() => { globalThis.__calcoli = 0; });
  await moduloParere(page);
  const modulo = page.locator('#previewModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 15_000 });
  const prima = await calcoli(app);
  await page.waitForTimeout(4000);
  expect(await calcoli(app), 'richieste ripetute da sole').toBe(prima);
  expect(prima).toBeLessThanOrEqual(2);
  console.log('PARERE SENZA INVITO:', await modulo.innerText());
  await page.screenshot({ path: `${SHOTS}/1344.1-g3-parere-senza-invito.png` }).catch(() => {});
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Crediti');
  // Passando da una carta all'altra e tornando: nessuna nuova richiesta per quelle già mancate.
  const n = await calcoli(app);
  for (let k = 0; k < 5; k++) {
    await page.locator('#deckList .dk-row[data-card-id="tome-1"]').hover();
    await page.locator('#deckList .dk-row[data-card-id="bolt-1"]').hover();
  }
  await page.waitForTimeout(1500);
  expect(await calcoli(app)).toBeLessThanOrEqual(n + 1);
});

test('parere con la rete assente o il servizio sovraccarico, nel carosello: nessuna raffica, e si dice', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  await mazzoConDueCarte(page);
  await app.evaluate(() => { globalThis.__parere = 'rete'; });
  await moduloParere(page);
  await page.waitForTimeout(500);
  await app.evaluate(() => { globalThis.__calcoli = 0; });
  await page.locator('#deckList .dk-row[data-card-id="bolt-1"]').click();
  await expect(page.locator('#stateCarousel')).toBeVisible({ timeout: 5_000 });
  const modulo = page.locator('#carouselModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 20_000 });
  const prima = await calcoli(app);
  await page.waitForTimeout(4000);
  console.log('RETE:', prima, await calcoli(app), await modulo.innerText());
  expect(await calcoli(app), 'richieste ripetute da sole nel carosello').toBe(prima);
  await page.screenshot({ path: `${SHOTS}/1344.1-g3-parere-rete.png` }).catch(() => {});

  await app.evaluate(() => { globalThis.__parere = '503'; });
  await modulo.locator('[data-op-retry]').click();
  await page.waitForTimeout(4000);
  const dopo = await calcoli(app);
  console.log('503:', dopo, await modulo.innerText());
  await page.waitForTimeout(3000);
  expect(await calcoli(app)).toBe(dopo);
  await expect(modulo.locator('.dk-op-errore')).toBeVisible();
});

test('descrizione di un’immagine copiata col modello servito solo da fornitori esclusi: avviso con «Apri Opzioni», la voce non promette', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const boom = () => {
      const e = new Error('No allowed providers are available for the selected model.');
      e.code = 'NO_ALLOWED_HOST'; e.model = 'google/gemini-2.5-flash'; e.hosts = ['Google AI Studio'];
      throw e;
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async () => boom();
    P.streamCompleteWithFallback = async () => boom();
    const O = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...O, streamComplete: boom, complete: boom };
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  const avviso = page.locator('.sn-toast').last();
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  console.log('ESCLUSI:', await avviso.innerText());
  await page.screenshot({ path: `${SHOTS}/1344.1-g3-descrizione-esclusi.png` }).catch(() => {});
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
  const descrizione = async () => {
    const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
    return ((storia && storia.items) || [])[0]?.description || '';
  };
  await expect.poll(descrizione, { timeout: 10_000 }).not.toBe('Descrizione…');
  console.log('VOCE:', await descrizione());
  await avviso.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://options');
});

test('descrizione di un’immagine copiata senza invito: avviso con «Apri Crediti», la voce non promette', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  const avviso = page.locator('.sn-toast').last();
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  console.log('SENZA INVITO:', await avviso.innerText());
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  const descrizione = async () => {
    const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
    return ((storia && storia.items) || [])[0]?.description || '';
  };
  await expect.poll(descrizione, { timeout: 10_000 }).not.toBe('Descrizione…');
  console.log('VOCE:', await descrizione());
});

test('Editor senza modello per titolo e riassunto: dicono perché e portano alle Opzioni', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const vuoti = {};
    for (const [k, v] of Object.entries(C.ACTIONS)) if (/TITLE|SUMMAR|TITOL|RIASS/i.test(k)) vuoti[v] = '';
    globalThis.__vuoti = Object.keys(vuoti);
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, ...vuoti },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  console.log('AZIONI SVUOTATE:', await app.evaluate(() => globalThis.__vuoti));
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Una nota sul bilancio del trimestre, con le spese di manutenzione.');
  for (const voce of ['Rigenera titolo', 'Rigenera riassunto']) {
    await editor.locator('#docTitle').click({ button: 'right' });
    await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: voce }).click();
    const avviso = editor.locator('.ed-toast').last();
    await expect(avviso).toBeVisible({ timeout: 15_000 });
    console.log(voce, '→', await avviso.innerText());
    await expect(avviso).not.toContainText('Scrivi qualcosa');
    await expect(avviso.locator('.ed-toast-action')).toHaveText('Apri Opzioni');
    await editor.waitForTimeout(500);
  }
  await editor.screenshot({ path: `${SHOTS}/1344.1-g3-editor-senza-modello.png` }).catch(() => {});
});
