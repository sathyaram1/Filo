// I contatori del servizio (#1472) nell'app vera: una risposta servita conta chi l'ha pagata e chi l'ha servita, una
// chiamata senza modello conta una volta sola anche passando da due porte, la prova di un modello proprietario con
// «solo pesi aperti» si conta come bloccata. Forma, spedizione e regole: tests/unit/contatoriServizio.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

// Le ore di oggi sommate, misura per misura.
const servizio = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const g = globalThis.SN_CONTATORI.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`) || !ora.servizio) continue;
    for (const [m, conti] of Object.entries(ora.servizio)) {
      for (const [chiave, n] of Object.entries(conti || {})) (out[m] = out[m] || {})[chiave] = ((out[m] || {})[chiave] || 0) + n;
    }
  }
  return out;
});
const voce = async (app, misura, chiave) => ((await servizio(app))[misura] || {})[chiave] || 0;
const statoContatori = (app) => app.evaluate(async () => JSON.stringify(await globalThis.SN_CONTATORI_MAIN.letto()));

// Il router finto nel main, al posto della rete: risponde servito da DeepInfra.
async function routerFinto(app, impostazioni = {}) {
  await app.evaluate(async (_e, extra) => {
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test-servizio' },
      modelRegistry: T.registry, models: { ...T.models }, ...extra,
    });
    if (!globalThis.__fetchVeroServizio) {
      globalThis.__fetchVeroServizio = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (!u.includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVeroServizio(url, init);
        const body = JSON.parse(init.body);
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco.' }, finish_reason: 'stop' }], usage: {} }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  }, impostazioni);
}

test('una spiegazione servita conta chi l’ha pagata; senza modello conta la chiamata mai partita, una volta da ogni porta', async ({ app }) => {
  test.setTimeout(60_000);
  await routerFinto(app);
  const spiega = (via) => app.evaluate(async (_e, v) => {
    const H = globalThis.__filoHandlers;
    const C = globalThis.SN_CONST;
    const richiesta = { action: C.ACTIONS.EXPLAIN, payload: { messages: [{ role: 'user', content: 'cos’è un fotone' }] }, origin: 'test' };
    const fai = v === 'stream' ? H.handleStream({ ...richiesta, onDelta: () => {} }) : H.handleAIRequest(richiesta);
    return fai.then(() => 'ok', (e) => e.code || e.message);
  }, via);
  expect(await spiega('richiesta')).toBe('ok');
  await expect.poll(() => voce(app, 'chiave_fonte', 'explain|own'), { timeout: 5_000 }).toBe(1);
  expect(await voce(app, 'servita_ignota', 'explain|deepseek/deepseek-chat'), 'DeepInfra l’ha detto nella risposta').toBe(0);

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ models: { ...s.models, [C.ACTIONS.EXPLAIN]: '' } });
  });
  expect(await spiega('richiesta')).toBe('NO_MODEL_FOR_ACTION');
  expect(await spiega('stream')).toBe('NO_MODEL_FOR_ACTION');
  await expect.poll(() => voce(app, 'mai_partita', 'explain|no_model_for_action'), { timeout: 5_000 }).toBe(2);
  await new Promise((r) => setTimeout(r, 300));
  expect(await voce(app, 'mai_partita', 'explain|no_model_for_action'), 'una chiamata, un conto: chi la chiede e il cancello non la contano due volte').toBe(2);
  expect(await statoContatori(app)).not.toContain('k-test-servizio');
});

test('«solo pesi aperti»: la prova di un modello proprietario si ferma e si conta, e lo stato entra nell’ora', async ({ app, openTab }) => {
  await routerFinto(app, { openWeightsOnly: true });
  const opzioni = await openTab('filo://options/options.html');
  const r = await opzioni.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.TEST_PROVIDER, provider: 'openrouter', model: 'anthropic/claude-sonnet-4', apiKey: 'k-test-servizio',
  }));
  expect(r.ok).toBe(false);
  await expect.poll(() => voce(app, 'pesi_aperti', 'provider-test|blocco_model'), { timeout: 5_000 }).toBe(1);
  expect(await voce(app, 'pesi_aperti', 'stato|acceso')).toBeGreaterThan(0);
});
