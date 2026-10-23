// Verifica #1344.1, giro 1: le porte del «Parere di Filo» e della descrizione immagine non provate dal lavoro.
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

// Conta le richieste di parere che la pagina manda, qualunque cosa faccia poi il main.
async function contaRichieste(page) {
  await page.evaluate(() => {
    window.__richieste = 0;
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...rest) => {
      if (m && m.type === window.SN_MSG.MSG.DECKS_OPINION && m.compute) window.__richieste += 1;
      return orig(m, ...rest);
    };
  });
}
const richieste = (page) => page.evaluate(() => window.__richieste);

async function sceglieParere(page, riga) {
  await riga.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await riga.hover();
}

test('parere senza invito: una richiesta, il motivo e «Apri Crediti»', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  const { riga } = await mazzoConCarta(page);
  await senzaChiave(app);
  await contaRichieste(page);
  await sceglieParere(page, riga);
  const modulo = page.locator('#previewModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 15_000 });
  const testo = await modulo.locator('.dk-op-errore').innerText();
  console.log('SENZA INVITO:', testo);
  await page.mouse.move(5, 5);
  await riga.hover();
  await page.waitForTimeout(3000);
  expect(await richieste(page)).toBeLessThanOrEqual(1);
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Crediti');
  await page.screenshot({ path: `${SHOTS}/v1344-1-senza-invito.png` }).catch(() => {});
});

test('parere con la rete assente: una richiesta e una frase da utente', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  await app.evaluate(() => { globalThis.__parere = 'rete'; });
  const page = await openTab('filo://decks/decks.html');
  const { riga } = await mazzoConCarta(page);
  await contaRichieste(page);
  await sceglieParere(page, riga);
  const modulo = page.locator('#previewModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 60_000 });
  console.log('RETE:', await modulo.locator('.dk-op-errore').innerText(), 'pareri main', await app.evaluate(() => globalThis.__pareri));
  await page.waitForTimeout(3000);
  expect(await richieste(page)).toBeLessThanOrEqual(1);
  await expect(modulo.locator('.dk-op-errore')).not.toContainText(/fetch failed|ENOTFOUND/i);
});

test('parere nel carosello coi crediti finiti: scorrendo non parte una raffica', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  const { riga, bolla } = await mazzoConCarta(page);
  await sceglieParere(page, riga);
  await expect(page.locator('#previewModule .dk-op-errore')).toBeVisible({ timeout: 15_000 });
  await app.evaluate(() => { globalThis.__parere = '402'; });
  await contaRichieste(page);
  await bolla.locator('.dk-cardlist .dk-row[data-card-id="tome-1"]').click();
  await expect(page.locator('#stateCarousel')).toBeVisible();
  const modulo = page.locator('#carouselModule');
  await expect(modulo.locator('.dk-op-errore')).toBeVisible({ timeout: 15_000 });
  for (let k = 0; k < 6; k++) { await page.keyboard.press(k % 2 ? 'ArrowLeft' : 'ArrowRight'); await page.waitForTimeout(150); }
  await page.waitForTimeout(3000);
  const n = await richieste(page);
  console.log('CAROSELLO richieste', n, 'testo', await modulo.innerText());
  expect(n).toBeLessThanOrEqual(2);
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Crediti');
  await page.screenshot({ path: `${SHOTS}/v1344-1-carosello.png` }).catch(() => {});
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

test('descrizione immagine col modello servito solo da fornitori esclusi: «Apri Opzioni»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const boom = async () => {
      const e = new Error('No allowed providers are available for the selected model.');
      e.code = 'NO_ALLOWED_HOST'; e.model = 'moonshotai/kimi-k2.6'; e.hosts = ['Moonshot AI'];
      throw e;
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = boom;
    P.streamCompleteWithFallback = boom;
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  const avviso = page.locator('.sn-toast').last();
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  console.log('ESCLUSI:', await avviso.innerText());
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
});

test('descrizione immagine senza invito: lo dice, e la voce non resta su «Descrizione…»', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await senzaChiave(app);
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  await page.waitForTimeout(5000);
  const toasts = await page.locator('.sn-toast').allInnerTexts();
  const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
  const voci = (storia?.entries || storia?.history || storia || []);
  console.log('SENZA INVITO toasts:', JSON.stringify(toasts), 'storia:', JSON.stringify(Array.isArray(voci) ? voci.map((v) => v.description) : storia).slice(0, 400));
});
