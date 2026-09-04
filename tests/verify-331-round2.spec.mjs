// Verifica #331 (secondo giro, avversariale): famiglie di errori del SERVIZIO
// AI non coperte dal primo giro — 429/5xx strutturati, messaggio non marcato
// nella forma "Gemini 503: …", errore ignoto con payload HTML ostile. In chat
// non deve MAI arrivare un codice tecnico né markup eseguibile.

import { test, expect } from './fixtures/electron.mjs';

async function baseMocks(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const NIV = {
      id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}{U}{U}{R}{R}{R}', cmc: 6,
      type_line: 'Legendary Creature — Dragon Wizard', colors: ['U', 'R'], color_identity: ['U', 'R'],
      image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
      prices: { eur: '3.21' }, legalities: { commander: 'legal' },
      scryfall_uri: 'https://scryfall.com/card/niv',
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/cards/niv-1') return { ok: true, status: 200, json: async () => NIV };
      if (u.pathname === '/symbology') return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (u.pathname === '/cards/search') return { ok: true, status: 200, json: async () => ({ data: [], has_more: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => (
      { text: JSON.stringify({ reply: 'Ok.' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} }
    );
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ onReasoning }) => {
      for (const t of (globalThis.__reasoningChunks || [])) {
        try { onReasoning && onReasoning(t); } catch (_) {}
      }
      const spec = globalThis.__streamThrow;
      const e = new Error(spec.message);
      if (spec.code) e.code = spec.code;
      if (spec.status) e.status = spec.status;
      if (spec.provider) e.provider = spec.provider;
      throw e;
    };
  });
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

async function sendAndSettle(page, text) {
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 10_000 });
}

test('provider 429 strutturato → «sovraccarico», nessun codice', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__streamThrow = { message: 'OpenRouter 429: Too Many Requests', status: 429, provider: 'openrouter' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await sendAndSettle(page, 'ciao');
  await expect(page.locator('#chatLog')).not.toContainText('429');
  await expect(page.locator('#chatLog')).not.toContainText('OpenRouter');
  await expect(page.locator('#chatLog')).toContainText(/sovraccarico|non disponibile/i);
  await expect(page.locator('#chatLog')).toContainText(/riprova/i);
});

test('provider 503 solo nel testo («Gemini 503: …») → frase comprensibile', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    // Nessun marcatore strutturato: solo la forma del messaggio. La rete di
    // sicurezza deve riconoscerla comunque.
    globalThis.__streamThrow = { message: 'Gemini 503: Service Unavailable' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await sendAndSettle(page, 'ciao');
  await expect(page.locator('#chatLog')).not.toContainText('503');
  await expect(page.locator('#chatLog')).not.toContainText('Gemini');
  await expect(page.locator('#chatLog')).toContainText(/sovraccarico|non disponibile/i);
});

test('errore ignoto con HTML ostile → frase generica, niente leak né XSS', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__reasoningChunks = ['Pensavo al mazzo…'];
    globalThis.__streamThrow = { message: 'ERR_BOOM <img src=x onerror="window.__xssE=1"> stacktrace at line 42' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await sendAndSettle(page, 'ciao');
  // Il testo tecnico NON deve filtrare in chat (né come testo né come DOM)…
  await expect(page.locator('#chatLog')).not.toContainText('ERR_BOOM');
  await expect(page.locator('#chatLog')).not.toContainText('stacktrace');
  const xss = await page.evaluate(() => window.__xssE);
  expect(xss).toBe(undefined);
  expect(await page.locator('#chatLog img').count()).toBe(0);
  // …ma una frase in italiano sì, e il ragionamento raccolto resta visibile.
  await expect(page.locator('#chatLog')).toContainText(/riprova/i);
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cot')).toBeVisible();
  await bubble.locator('.dk-cot').click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toContainText('Pensavo al mazzo');
});

test('chiave mancante (NO_API_KEY) → messaggio già umano, invariato', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__streamThrow = { message: 'Nessuna chiave API configurata: aprila nelle Impostazioni.', code: 'NO_API_KEY' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);
  await sendAndSettle(page, 'ciao');
  await expect(page.locator('#chatLog')).toContainText(/chiave API/i);
  await expect(page.locator('#chatLog')).not.toContainText('NO_API_KEY');
});
