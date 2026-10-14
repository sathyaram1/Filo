// Verifica: il pulsante «Prova» delle Opzioni misura la velocità con le stesse
// istruzioni di routing che userebbe una richiesta vera. Senza l'ordinamento
// degli host scelto per quel modello misurerebbe un host diverso da quello che
// servirà davvero.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__provaFornitoreAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__provaFornitoreAttivo = true;
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9},"provider":"Baseten"}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

// L'ordinamento degli host si sceglie sui modelli predefiniti (pagina
// dell'owner): si mettono dove il codice li legge.
async function predefinitiConOrdinamento(app) {
  await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroProva) globalThis.__getVeroProva = D.get;
    D.get = (...a) => {
      const base = globalThis.__getVeroProva(...a);
      return {
        ...base,
        apiKeys: { ...base.apiKeys, openrouter: 'sk-or-finta-ordine-host' },
        modelRegistry: {
          'prova-veloce': {
            provider: 'openrouter', model: 'finto/prova-veloce',
            sort: 'throughput', reasoning: 'high',
          },
        },
      };
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: {},
    });
  });
}

test('la prova di un modello predefinito parte con l\'ordinamento degli host di quel modello', async ({ app, openTab }) => {
  await predefinitiConOrdinamento(app);
  await intercetta(app);

  const page = await openTab(OPZIONI);
  const riga = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

  const partita = await app.evaluate(async () =>
    globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).pop());
  expect(partita, 'nessuna richiesta partita dalla prova').toBeTruthy();
  expect(partita.corpo.model).toBe('finto/prova-veloce');
  expect(partita.corpo.provider && partita.corpo.provider.ignore,
    'lista di esclusione assente nella prova').toBeTruthy();
  expect(partita.corpo.provider && partita.corpo.provider.sort,
    'la prova misura la velocità su un host scelto con un altro criterio rispetto all\'uso vero')
    .toBe('throughput');
  expect(partita.corpo.reasoning && partita.corpo.reasoning.effort,
    'la prova misura la velocità senza il livello di ragionamento del modello').toBe('high');
});
