// Stress test avversariale (verifica #331): CoT con payload XSS, provider che
// fallisce con codici HTTP grezzi, doppio invio rapido, preferenza utente sul
// blocco Ragionamento, ragionamento su bolla d'errore.
//
// ⚠️ NOTA per il fixer: il test «provider KO con codice HTTP grezzo» è ROSSO
// di proposito — documenta il gap trovato in verifica: quando è il PROVIDER
// AI (non Scryfall) a fallire con un errore HTTP, in chat compare ancora il
// codice grezzo («Non ha funzionato: OpenRouter 400: …»). Deve diventare
// verde col fix, senza ammorbidire gli assert.

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
    globalThis.__scryRequests = [];
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      globalThis.__scryRequests.push(String(url));
      const u = new URL(String(url));
      if (u.pathname === '/cards/niv-1') return { ok: true, status: 200, json: async () => NIV };
      if (u.pathname === '/symbology') return { ok: true, status: 200, json: async () => ({ data: [] }) };
      if (u.pathname === '/cards/search') {
        return { ok: true, status: 200, json: async () => ({ data: [], has_more: false }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.__chatCalls = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      return { text: JSON.stringify({ reply: 'Ok.' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onReasoning }) => {
      for (const t of (globalThis.__reasoningChunks || [])) {
        try { onReasoning && onReasoning(t); } catch (_) {}
      }
      if (globalThis.__streamDelay) {
        await new Promise((res) => setTimeout(res, globalThis.__streamDelay));
      }
      if (globalThis.__streamThrow) {
        const spec = globalThis.__streamThrow;
        const e = new Error(spec.message);
        if (spec.code) e.code = spec.code;
        throw e;
      }
      const r = await globalThis.SN_PROVIDERS.completeWithFallback({ attempts, messages });
      if (onDelta) onDelta(r.text);
      return r;
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

test('il ragionamento con payload HTML/XSS resta testo inerte', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__reasoningChunks = [
      'Prima <script>window.__xss1=1</script> ',
      '<img src=x onerror="window.__xss2=1"> e poi 😀 <a href="javascript:window.__xss3=1">link</a>',
    ];
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'come va il mazzo?');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText('Ok.');
  await bubble.locator('.dk-cot').click();
  const body = page.locator('.dk-msg-bot').last().locator('.dk-cot-body');
  await expect(body).toBeVisible();
  // Il markup è TESTO visibile, non DOM: nessun img/script/a dentro il blocco.
  await expect(body).toContainText('<img src=x onerror=');
  expect(await body.locator('img, script, a').count()).toBe(0);
  const flags = await page.evaluate(() => [window.__xss1, window.__xss2, window.__xss3]);
  expect(flags).toEqual([undefined, undefined, undefined]);
});

test('provider KO con codice HTTP grezzo → in chat nessun codice tecnico', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__streamThrow = { message: 'OpenRouter 400: Bad Request — invalid model' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'ciao');
  await page.press('#chatInput', 'Enter');
  // Deve comparire QUALCOSA (non restare "sta pensando" per sempre)…
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: 'tests/.shots/verify-331-provider-400.png' });
  // …e non deve contenere il codice tecnico "400" (lamentela #331.2)…
  await expect(page.locator('#chatLog')).not.toContainText('400');
  await expect(page.locator('#chatLog')).not.toContainText('Bad Request');
  await expect(page.locator('#chatLog')).not.toContainText('OpenRouter');
  // …ma una spiegazione comprensibile di cosa non ha funzionato e cosa fare.
  await expect(page.locator('#chatLog')).toContainText(/servizio AI/i);
  await expect(page.locator('#chatLog')).toContainText(/riprova/i);
});

test('provider KO 401 → invito a controllare la chiave, senza codici', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    const e = { message: 'OpenRouter 401: Unauthorized' };
    globalThis.__streamThrow = e;
    // Il provider vero attacca status/provider all'errore HTTP: qui simuliamo
    // quel contratto (vedi unit test providers-errors) per verificare che la
    // chat lo traduca nel consiglio giusto (chiave, non modello).
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async () => {
      const err = new Error(e.message);
      err.status = 401;
      err.provider = 'openrouter';
      throw err;
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'ciao');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#chatLog')).not.toContainText('401');
  await expect(page.locator('#chatLog')).toContainText(/chiave/i);
});

test('provider KO di rete → frase comprensibile', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__streamThrow = { message: 'fetch failed' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'ciao');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#chatLog')).toContainText(/rete|connessione/i);
  await expect(page.locator('#chatLog')).not.toContainText('fetch failed');
});

test('limite di spesa raggiunto → messaggio i18n invariato, con ragionamento raccolto', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__reasoningChunks = ['Stavo pensando al mazzo…'];
    globalThis.__streamThrow = { message: 'Limite di spesa raggiunto per questo mese.', code: 'LIMIT_REACHED' };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'ciao');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#chatLog')).toContainText('Limite di spesa raggiunto');
  // #331.oltre: il ragionamento raccolto prima del fallimento resta visibile
  // anche nella bolla d'errore.
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble.locator('.dk-cot')).toBeVisible();
  await bubble.locator('.dk-cot').click();
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-cot-body')).toContainText('Stavo pensando');
});

test('doppio Enter rapido → un solo turno; la scelta utente sul CoT persiste', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    globalThis.__reasoningChunks = ['Ragiono.'];
    globalThis.__streamDelay = 1200; // il primo turno resta pending abbastanza
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  // Due submit ravvicinati: il secondo (durante il pending) va ignorato.
  await page.fill('#chatInput', 'primo messaggio');
  await page.press('#chatInput', 'Enter');
  await page.fill('#chatInput', 'secondo mentre pende');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText('Ok.', { timeout: 10_000 });
  await expect(page.locator('.dk-msg-user')).toHaveCount(1);
  await app.evaluate(() => { globalThis.__streamDelay = 0; });

  // Apro il CoT della prima bolla, mando un nuovo messaggio: resta aperto.
  await bubble.locator('.dk-cot').click();
  await expect(page.locator('.dk-msg-bot').first().locator('.dk-cot-body')).toBeVisible();
  await page.fill('#chatInput', 'secondo turno vero');
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-bot')).toHaveCount(2);
  await expect(page.locator('.dk-msg-bot').first().locator('.dk-cot-body')).toBeVisible();
  // 10.000 caratteri nel campo: non deve rompere il layout né il turno.
  await page.fill('#chatInput', 'x'.repeat(10_000));
  await page.press('#chatInput', 'Enter');
  await expect(page.locator('.dk-msg-user')).toHaveCount(3);
  await expect(page.locator('.dk-msg-bot').nth(2)).toContainText('Ok.');
});

test('query rifiutata con HTML nei dettagli → spiegazione senza XSS né codici', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await baseMocks(app);
  await app.evaluate(() => {
    // LLM: SEMPRE la stessa query rotta contenente markup ostile.
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__chatCalls.push(messages);
      return {
        text: JSON.stringify({ reply: 'Cerco.', query: '<img src=x onerror="window.__xssq=1"> (o:"rotta' }),
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/cards/search') {
        return { ok: false, status: 400, json: async () => ({ object: 'error', details: '<script>window.__xssd=1</script> broken' }) };
      }
      if (u.pathname === '/cards/niv-1') {
        return { ok: true, status: 200, json: async () => ({
          id: 'niv-1', name: 'Niv-Mizzet, Parun', mana_cost: '{U}', cmc: 6,
          type_line: 'Legendary Creature', colors: ['U', 'R'], color_identity: ['U', 'R'],
          image_uris: { normal: 'https://cards.test/niv.jpg', art_crop: 'https://cards.test/niv-art.jpg' },
          prices: { eur: '3.21' }, legalities: { commander: 'legal' },
          scryfall_uri: 'https://scryfall.com/card/niv',
        }) };
      }
      if (u.pathname === '/symbology') return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await deckWithCommander(page);

  await page.fill('#chatInput', 'cerca qualcosa');
  await page.press('#chatInput', 'Enter');
  const bubble = page.locator('.dk-msg-bot').last();
  await expect(bubble).toContainText(/riformul/i);
  await expect(page.locator('.dk-msg-error')).toHaveCount(0);
  await expect(page.locator('#chatLog')).not.toContainText('400');
  const flags = await page.evaluate(() => [window.__xssq, window.__xssd]);
  expect(flags).toEqual([undefined, undefined]);
  expect(await bubble.locator('img, script').count()).toBe(0);
});
