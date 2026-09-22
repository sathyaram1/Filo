// Verifica: il pulsante «Prova» misura la velocità con le stesse istruzioni di
// routing che userebbe una richiesta vera. Se il modello ha un criterio di
// ordinamento degli host, la prova deve partire con quello, altrimenti misura
// un host diverso da quello che servirà davvero.

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

// I modelli predefiniti sono quelli dell'owner: è lì che si sceglie
// l'ordinamento degli host, e si leggono da dove il codice li prende.
async function predefinitiConOrdinamento(app) {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroProva) globalThis.__getVeroProva = D.get;
    D.get = (...a) => {
      const base = globalThis.__getVeroProva(...a);
      return {
        ...base,
        modelRegistry: {
          ...base.modelRegistry,
          'prova-veloce': {
            provider: 'openrouter', model: 'finto/prova-veloce',
            sort: 'throughput', reasoning: 'high',
          },
        },
        models: { ...base.models, [A.PROVIDER_TEST]: 'prova-veloce' },
      };
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
    });
  });
}

test('la prova della chiave parte con l\'ordinamento degli host scelto per quel modello', async ({ app, openTab }) => {
  await predefinitiConOrdinamento(app);
  await intercetta(app);

  const page = await openTab(OPZIONI);
  await page.waitForSelector('#testOpenrouter', { timeout: 15_000 });
  await page.locator('#testOpenrouter').click();
  await expect(page.locator('#testOpenrouterStatus')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });

  const partita = await app.evaluate(async () =>
    globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).pop());
  expect(partita, 'nessuna richiesta partita dalla prova').toBeTruthy();
  expect(partita.corpo.model).toBe('finto/prova-veloce');
  // La lista di esclusione c'è sempre: è la parte che regge.
  expect(partita.corpo.provider && partita.corpo.provider.ignore,
    'lista di esclusione assente nella prova').toBeTruthy();

  expect(partita.corpo.provider && partita.corpo.provider.sort,
    'la prova misura la velocità su un host scelto con un altro criterio rispetto all\'uso vero')
    .toBe('throughput');
  expect(partita.corpo.reasoning && partita.corpo.reasoning.effort,
    'la prova misura la velocità senza il livello di ragionamento del modello').toBe('high');
});

test('la prova della stessa riga dalla pagina dei modelli predefiniti l\'ordinamento ce l\'ha', async ({ app, openTab }) => {
  await predefinitiConOrdinamento(app);
  await intercetta(app);

  // Stessa azione, altra pagina: qui l'ordinamento della riga viaggia col
  // messaggio, ed è il metro di paragone della prova qui sopra.
  const esito = await app.evaluate(async () => {
    const M = globalThis.SN_MESSAGES || globalThis.SN_CONST.MSG;
    return globalThis.__filoTestSend
      ? globalThis.__filoTestSend({ type: M.TEST_DEFAULT_MODEL, nickname: 'prova-veloce', provider: 'openrouter', model: 'finto/prova-veloce', reasoning: 'high', sort: 'throughput' })
      : null;
  }).catch(() => null);
  test.skip(esito === null, 'niente scorciatoia per parlare col main da qui');

  const partita = await app.evaluate(async () =>
    globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).pop());
  expect(partita.corpo.provider.sort).toBe('throughput');
});
