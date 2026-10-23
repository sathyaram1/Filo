// Verifica #1461 dopo il riallineamento: gli avvisi «fuori politica» arrivati da main (fornitore escluso, produttore
// sbagliato) vanno a tutte le finestre come quello dei pesi aperti, e la pagina Privacy dice che quelli si contano.

import { test, expect } from '../../fixtures/electron.mjs';

const oggi = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const tot = {};
  for (const [k, v] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [e, n] of Object.entries(v.erroriVisti || {})) tot[e] = (tot[e] || 0) + n;
  }
  return tot;
});

async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function prepara(app, openWeightsOnly) {
  await app.evaluate(async (_e, ow) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: ow,
      apiKeys: { openrouter: 'sk-or-v1-own-key-1461' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-claude': { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'mio-claude' },
    });
    const vero = globalThis.__vero1461 || globalThis.fetch;
    globalThis.__vero1461 = vero;
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Anthropic', tag: 'anthropic' }, { provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
      }
      if (!u.startsWith('https://openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      return json({ provider: globalThis.__host1461, choices: [{ message: { content: 'Risposta finta 1461' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    };
  }, openWeightsOnly);
}

const spiega = (app, azione, testo, host) => app.evaluate(async (_e, { azione: a, testo: t, host: h }) => {
  globalThis.__host1461 = h;
  const C = globalThis.SN_CONST;
  const r = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AI_REQUEST, action: C.ACTIONS[a], payload: { selection: t, sentence: `${t} in una frase` } }, {});
  return Boolean(r && !r.error);
}, { azione, testo, host });

const avvisiContati = async (app) => Object.entries(await oggi(app)).filter(([k]) => k.startsWith('avviso:')).reduce((a, [, n]) => a + n, 0);

test('r1 l’avviso del fornitore escluso e quello del produttore sbagliato si contano fra gli errori visti', async ({ app }) => {
  test.setTimeout(90_000);
  const chat = await home(app);
  await prepara(app, false);

  const prima = await avvisiContati(app);
  expect(await spiega(app, 'EXPLAIN', 'parola1461 esclusa', 'DeepSeek')).toBe(true);
  await expect(chat.locator('.sn-toast', { hasText: '«DeepSeek»' })).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => avvisiContati(app), { timeout: 5_000, message: 'l’avviso del fornitore escluso, visto, non si conta' }).toBe(prima + 1);

  expect(await spiega(app, 'EXPLAIN_DEEP', 'parola1461 bedrock', 'Amazon Bedrock')).toBe(true);
  await expect(chat.locator('.sn-toast', { hasText: '«Amazon Bedrock»' })).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => avvisiContati(app), { timeout: 5_000, message: 'l’avviso del produttore sbagliato, visto, non si conta' }).toBe(prima + 2);
});

test('con «solo pesi aperti» l’avviso si conta come pesi aperti violati', async ({ app }) => {
  test.setTimeout(60_000);
  const chat = await home(app);
  await prepara(app, true);
  expect(await spiega(app, 'EXPLAIN', 'parola1461 pesi', 'Google')).toBe(true);
  await expect(chat.locator('.sn-toast', { hasText: '«Google»' })).toBeVisible({ timeout: 8_000 });
  await expect.poll(async () => (await oggi(app))['avviso:pesi_aperti_violati'] || 0, { timeout: 5_000 }).toBe(1);
});
