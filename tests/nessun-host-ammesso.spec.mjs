// #828: un modello che su OpenRouter servono solo host esclusi dalla politica. Chat, funzioni e «Prova» delle Opzioni
// dicono quale modello, quale funzione, perché e dove sceglierne un altro, senza invitare a riprovare.
// Regole pure: tests/unit/nessunHostAmmesso.test.mjs e, per la coda della chiave propria, chiavePropriaFornitori.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const GEMINI = 'google/gemini-2.5-flash';
// Pesi aperti: i crediti di Filo lo pagano (#830), e nel catalogo finto lo servono gli stessi host esclusi di Gemini.
const GEMMA = 'google/gemma-4-31b-it';
// Qui paga la chiave propria con l'interruttore dei fornitori esclusi spento: la frase indica anche quella strada (#962).
const CHIAVE_PROPRIA = 'Visto che paghi con la tua chiave, puoi anche accendere «Con la mia chiave, usa anche i fornitori esclusi» in Opzioni.';
const SPIEGAZIONE = `non può usare «google/gemini-2.5-flash» perché nessun fornitore ammesso lo ospita. Lo servono solo Google AI Studio e Google Vertex, che Filo esclude. Scegline un altro in Opzioni → Modelli per azione. ${CHIAVE_PROPRIA}`;

// Il router finto nel main: il catalogo dice che Gemini e Gemma li servono solo host di Google, e la richiesta, che li
// esclude, riceve il 404 del router; ogni altro modello risponde. `crediti`: niente chiave propria, paga il portafoglio.
async function preparaRouter(app, modelli, { crediti = false } = {}) {
  await app.evaluate(async (_e, { GEMINI, GEMMA, modelli, crediti }) => {
    const C = globalThis.SN_CONST;
    if (crediti) {
      const Module = process.getBuiltinModule('module');
      const path = process.getBuiltinModule('path');
      const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
      req('./auth/wallet-store').save({ key: 'sk-or-v1-personal-718', pseudonym: 'prova718' });
    }
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: crediti ? '' : 'k-test' },
      modelRegistry: {
        ...globalThis.SN_TEST_MODELS.registry,
        'gemini-x': { provider: 'openrouter', model: GEMINI },
        'gemma-x': { provider: 'openrouter', model: GEMMA },
      },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: modelli, [C.ACTIONS.EXPLAIN]: modelli },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__corpi = [];
    if (globalThis.__fetchVero) return;
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        const endpoints = u.includes('/models/google/')
          ? [{ provider_name: 'Google AI Studio', tag: 'google-ai-studio' }, { provider_name: 'Google Vertex', tag: 'google-vertex' }]
          : [{ provider_name: 'DeepInfra', tag: 'deepinfra', supported_parameters: ['tools', 'reasoning', 'max_tokens'] }];
        return json({ data: { endpoints } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
      const body = JSON.parse(init.body);
      globalThis.__corpi.push({ model: body.model, ignore: (body.provider && body.provider.ignore) || [], key: String((init.headers && init.headers.Authorization) || '').replace('Bearer ', '') });
      if (body.model === GEMINI || body.model === GEMMA) return json({ error: { code: 404, message: 'No allowed providers are available for the selected model.' } }, 404);
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return json({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} });
    };
  }, { GEMINI, GEMMA, modelli, crediti });
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

// Il testo della bolla senza i tasti sotto (il «↻ Riprova» della chat rimanda il messaggio dopo aver cambiato modello).
const fraseDellaBolla = (bolla) => bolla.evaluate((el) => {
  const c = el.cloneNode(true);
  c.querySelectorAll('.dash-bubble-actions').forEach((x) => x.remove());
  return c.textContent.trim();
});

test('la chat della home dice quale modello e quale funzione, perché, e dove sceglierne un altro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'gemini-x');

  await page.locator('#input').fill('che tempo fa domani a Roma?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso lo ospita' });
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  const frase = await fraseDellaBolla(bolla);
  expect(frase).toBe(`La funzione «Home — chat con Filo» ${SPIEGAZIONE}`);
  expect(frase).not.toMatch(/riprov/i);
  await expect(bolla.getByRole('button', { name: 'Apri Opzioni' })).toBeVisible();
  const corpi = await app.evaluate(() => globalThis.__corpi);
  expect(corpi.length).toBeGreaterThan(0);
  expect(corpi.every((b) => b.model === GEMINI && b.ignore.includes('Google'))).toBe(true);
  await page.screenshot({ path: 'tests/.shots/828-chat-nessun-host-ammesso.png' });
});

test('con un secondo modello nella catena la chat risponde con quello, come prima', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'gemini-x, deepseek-flash');

  await page.locator('#input').fill('dimmi una curiosità');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso' })).toHaveCount(0);
  const modelli = await app.evaluate(() => globalThis.__corpi.map((b) => b.model));
  expect(modelli[0]).toBe(GEMINI);
  expect(modelli[modelli.length - 1]).not.toBe(GEMINI);
});

test('«Spiega» riceve la stessa frase, col suo nome', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, 'gemini-x');
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.AI_REQUEST, action: globalThis.SN_CONST.ACTIONS.EXPLAIN, payload: { selection: 'neve', sentence: 'nevica in montagna' } },
    { url: 'filo://newtab/newtab.html' },
  ).then((x) => x, (e) => ({ ok: false, error: e.message, code: e.code })));
  expect(r.ok).toBe(false);
  expect(r.code).toBe('NO_ALLOWED_HOST');
  expect(r.error).toBe(`La funzione «Spiega (inline)» ${SPIEGAZIONE}`);
});

// #718.2: l'interruttore c'è solo con la chiave propria, e la frase non lo propone a chi paga coi crediti di Filo.
test('coi crediti di Filo chat e «Spiega» non propongono l’interruttore della chiave propria', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'gemma-x', { crediti: true });
  const crediti = 'non può usare «google/gemma-4-31b-it» perché nessun fornitore ammesso lo ospita. Lo servono solo Google AI Studio e Google Vertex, che Filo esclude. Scegline un altro in Opzioni → Modelli per azione.';

  await page.locator('#input').fill('che tempo fa domani a Roma?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso lo ospita' });
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  expect(await fraseDellaBolla(bolla)).toBe(`La funzione «Home — chat con Filo» ${crediti}`);
  await expect(bolla.getByRole('button', { name: 'Apri Opzioni' })).toBeVisible();

  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.AI_REQUEST, action: globalThis.SN_CONST.ACTIONS.EXPLAIN, payload: { selection: 'neve', sentence: 'nevica in montagna' } },
    { url: 'filo://newtab/newtab.html' },
  ).then((x) => x, (e) => ({ ok: false, error: e.message, code: e.code })));
  expect(r.code).toBe('NO_ALLOWED_HOST');
  expect(r.error).toBe(`La funzione «Spiega (inline)» ${crediti}`);

  const corpi = await app.evaluate(() => globalThis.__corpi);
  expect(corpi.length).toBeGreaterThan(0);
  expect(corpi.every((b) => b.model === GEMMA && b.key === 'sk-or-v1-personal-718' && b.ignore.includes('Google'))).toBe(true);
  await page.screenshot({ path: 'tests/.shots/718-crediti-nessun-host-ammesso.png' });
});

test('il «Prova» di una riga delle Opzioni su quel modello mostra la stessa spiegazione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await preparaRouter(app, 'gemini-x');
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 8_000 });
  await page.waitForFunction((id) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === id), GEMINI, { timeout: 8_000 });
  await page.evaluate((id) => {
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === id);
    input.closest('.sn-model-row').dataset.provaGemini = '1';
  }, GEMINI);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-prova-gemini="1"]');
  await expect(riga).toHaveCount(1);
  await riga.locator('.sn-model-test').click();
  const stato = riga.locator('.sn-model-row-status');
  await expect(stato).toContainText('nessun fornitore ammesso', { timeout: 15_000 });
  await expect(stato).toContainText(`Filo ${SPIEGAZIONE}`);
  await expect(stato).not.toContainText(/riprov/i);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/828-prova-nessun-host-ammesso.png' });
});
