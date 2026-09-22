// Verifica della «scelta generale» a cui rimanda la voce «Automatico»: deve
// esistere un posto per vederla e cambiarla, e deve reggere un valore scritto
// in un modo ragionevole ma diverso (maiuscole, spazi) invece di sparire.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';
const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__sceltaGeneraleAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__sceltaGeneraleAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      if (u.includes('/chat/completions')) {
        return new Response(JSON.stringify({
          id: 'gen-finta', provider: 'Baseten',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

async function generaleA(app, valore) {
  await app.evaluate(async (_e, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroGen) globalThis.__getVeroGen = D.get;
    D.get = (...a) => ({ ...globalThis.__getVeroGen(...a), providerSort: v });
  }, valore);
}

async function preparaModello(app) {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: { senza: { provider: 'openrouter', model: 'finto/senza' } },
      models: { [A.EXPLAIN]: 'senza' },
    });
  });
}

async function chiediSpiegazione(app, page) {
  const esito = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'explain',
    payload: { messages: [{ role: 'user', content: 'scelta generale ' + Date.now() }] },
  }));
  expect(esito && esito.ok, `chiamata fallita: ${JSON.stringify(esito)}`).toBeTruthy();
  return app.evaluate(async () =>
    globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).pop());
}

test('la scelta generale scritta con le maiuscole vale come quella scritta minuscola', async ({ app, openTab }) => {
  test.fail(true, 'rilievo aperto: la scelta generale non viene normalizzata come quella per modello');
  await preparaModello(app);
  await generaleA(app, 'Price');
  await intercetta(app);

  const page = await openTab(PAGINA);
  const partita = await chiediSpiegazione(app, page);
  expect(partita, 'nessuna richiesta partita').toBeTruthy();
  expect(partita.corpo.provider && partita.corpo.provider.sort,
    'la scelta generale scritta «Price» invece di «price» viene buttata via in silenzio: nessun ordine parte')
    .toBe('price');
});

test('la scelta generale si può vedere e cambiare dalla pagina dei modelli predefiniti', async ({ openTab }) => {
  test.fail(true, 'rilievo aperto: la scelta generale non ha una manopola in nessuna pagina');
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { veloce: { provider: 'openrouter', model: 'vendor/uno' } },
      models: {},
      excludedProviders: [],
      providerSort: 'price',
    };
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          default: return { ok: true };
        }
      };
    };
    attacca();
  });
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });

  // Ogni riga dice «Automatico»: segue la scelta generale. Da qualche parte
  // quella scelta dev'essere visibile, o «Automatico» rimanda al nulla.
  const controlli = await page.evaluate(() => {
    const fuoriDalleRighe = (el) => !el.closest('.sn-model-row');
    const selects = Array.from(document.querySelectorAll('select')).filter(fuoriDalleRighe);
    return selects.map((s) => ({
      id: s.id,
      voci: Array.from(s.options).map((o) => o.value),
    })).filter((s) => s.voci.includes('throughput') || s.voci.includes('price'));
  });
  expect(controlli.length,
    'nessun posto dove vedere o cambiare la scelta generale degli host a cui «Automatico» rimanda')
    .toBeGreaterThan(0);
});
