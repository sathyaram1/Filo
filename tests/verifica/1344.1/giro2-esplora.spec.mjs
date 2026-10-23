// Esplorazione del giro 2 di #1344.1: strade del «Parere di Filo» e della descrizione delle immagini non coperte.
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = 'tests/.shots';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

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

// Il parere segue `__parere`: 'rete' = connessione caduta, '503' = servizio sovraccarico, 'salta' = senza la carta.
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
        if (globalThis.__parere === 'rete') {
          throw Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
        }
        if (globalThis.__parere === '503') {
          throw Object.assign(new Error('OpenRouter 503: {"error":{"message":"overloaded"}}'), { status: 503, provider: 'openrouter' });
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

async function contaRichiesteParere(page) {
  await page.evaluate(() => {
    window.__richieste = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      if (msg && msg.type === window.SN_MSG.MSG.DECKS_OPINION) window.__richieste += 1;
      return orig(msg, ...rest);
    };
  });
}
const richieste = (page) => page.evaluate(() => window.__richieste);

async function preparaMazzo(app, openTab) {
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
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
  await bolla.locator('[data-add="tome-1"]').click();
  await expect(page.locator('#deckList .dk-row[data-card-id="tome-1"]')).toBeVisible();
  return { page, bolla };
}

async function scegliParere(page, riga) {
  await riga.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await riga.hover();
}

for (const modo of ['rete', '503']) {
  test(`parere con ${modo}: niente raffica, il motivo è detto`, async ({ app, shell, openTab }) => {
    test.setTimeout(120_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const { page } = await preparaMazzo(app, openTab);
    await app.evaluate((m) => { globalThis.__parere = m; globalThis.__pareri = 0; }, modo);
    await contaRichiesteParere(page);
    const bolt = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
    const tome = page.locator('#deckList .dk-row[data-card-id="tome-1"]');
    await scegliParere(page, bolt);
    const modulo = page.locator('#previewModule');
    await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 30_000 });
    // Su e giù fra le due carte, in fretta.
    for (let i = 0; i < 10; i++) { await tome.hover(); await bolt.hover(); }
    await page.waitForTimeout(3000);
    const n = await richieste(page);
    const p = await app.evaluate(() => globalThis.__pareri);
    console.log(`[${modo}] richieste pagina=${n} chiamate modello=${p} testo=«${await modulo.innerText()}»`);
    expect(n).toBeLessThanOrEqual(3);
    expect(p).toBeLessThanOrEqual(6);
    await page.screenshot({ path: `${SHOTS}/1344-g2-parere-${modo}.png` }).catch(() => {});
  });
}

test('parere senza invito: niente raffica, motivo e «Apri Crediti»', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const { page } = await preparaMazzo(app, openTab);
  await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    const orig = D.get;
    D.get = () => ({ ...orig(), apiKeys: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
  await contaRichiesteParere(page);
  const bolt = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
  await scegliParere(page, bolt);
  const modulo = page.locator('#previewModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  console.log(`[senza invito] richieste=${await richieste(page)} testo=«${await modulo.innerText()}»`);
  expect(await richieste(page)).toBeLessThanOrEqual(2);
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Crediti');
});

test('parere nel carosello che non arriva: avanti e indietro senza raffica', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const { page } = await preparaMazzo(app, openTab);
  await app.evaluate(() => { globalThis.__parere = 'salta'; globalThis.__pareri = 0; });
  const bolt = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
  await scegliParere(page, bolt);
  await contaRichiesteParere(page);
  await bolt.click();
  await expect(page.locator('#carouselModule')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#carouselModule .dk-op-errore')).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); }
  await page.waitForTimeout(3000);
  const p = await app.evaluate(() => globalThis.__pareri);
  console.log(`[carosello] richieste=${await richieste(page)} chiamate=${p} testo=«${await page.locator('#carouselModule').innerText()}»`);
  expect(await richieste(page)).toBeLessThanOrEqual(3);
  await page.screenshot({ path: `${SHOTS}/1344-g2-carosello.png` }).catch(() => {});
});

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('descrizione di un’immagine copiata col modello servito solo da fornitori esclusi: tasto per le Opzioni', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const GEMINI = 'google/gemini-2.5-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'gemini-x': { provider: 'openrouter', model: GEMINI } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.DESCRIBE_IMAGE]: 'gemini-x' },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Google AI Studio', tag: 'google-ai-studio' }] } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        return json({ error: { code: 404, message: 'No allowed providers are available for the selected model.' } }, 404);
      }
      return globalThis.__fetchVero(url, init);
    };
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  const avviso = page.locator('.sn-toast').last();
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  console.log(`[immagine esclusi] avviso=«${await avviso.innerText()}»`);
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
  const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
  console.log(`[immagine esclusi] cronologia=«${((storia && storia.items) || [])[0]?.description}»`);
  await page.screenshot({ path: `${SHOTS}/1344-g2-immagine-esclusi.png` }).catch(() => {});
});

test('Editor coi crediti finiti: «Rigenera titolo» dice perché e porta ai Crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => { const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'); e.status = 402; e.provider = 'openrouter'; throw e; };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Una nota sul bilancio del trimestre, con le spese di manutenzione.');
  for (const voce of ['Rigenera titolo', 'Rigenera riassunto']) {
    await editor.locator('#docTitle').click({ button: 'right' });
    await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: voce }).click();
    const avviso = editor.locator('.ed-toast').last();
    await expect(avviso).toBeVisible({ timeout: 15_000 });
    await expect(avviso.locator('.ed-toast-action')).toBeVisible({ timeout: 15_000 });
    console.log(`[editor ${voce}] avviso=«${await avviso.innerText()}»`);
    await expect(avviso.locator('.ed-toast-action')).toHaveText('Apri Crediti');
  }
  await editor.screenshot({ path: `${SHOTS}/1344-g2-editor-crediti.png` }).catch(() => {});
});
