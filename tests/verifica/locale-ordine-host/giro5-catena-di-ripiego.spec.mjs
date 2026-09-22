// I giri passati hanno provato l'ordinamento su un modello solo per cammino.
// Qui la strada che l'owner usa davvero: una funzione con più modelli in fila
// (primo, e se non risponde il secondo, e poi il terzo). Ogni modello deve
// chiamare col SUO criterio, e chi resta su automatico con quello generale,
// anche quando il turno arriva dopo un fallimento.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      const intestazioni = { 'content-type': 'application/json' };
      if (u.includes('/chat/completions')) {
        // I primi due modelli della fila non rispondono: il turno passa.
        if (corpo && /finto\/(primo|secondo)/.test(String(corpo.model || ''))) {
          return new Response(JSON.stringify({ error: { message: 'host non disponibile' } }),
            { status: 503, headers: intestazioni });
        }
        return new Response(JSON.stringify({
          id: 'gen-finta', provider: 'Baseten',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }), { status: 200, headers: intestazioni });
      }
      if (u.includes('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: intestazioni });
      return new Response(JSON.stringify({ data: {} }), { status: 200, headers: intestazioni });
    };
  });
}

async function generaleA(app, valore) {
  await app.evaluate(async (_e, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroGiro5) globalThis.__getVeroGiro5 = D.get;
    D.get = (...a) => ({ ...globalThis.__getVeroGiro5(...a), providerSort: v });
  }, valore);
}

async function listaAttesa(app) {
  return app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
  });
}

test('in una fila di modelli ognuno chiama col suo criterio, anche quando il turno arriva dopo un fallimento', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-catena' },
      modelRegistry: {
        primo: { provider: 'openrouter', model: 'finto/primo', sort: 'latency' },
        secondo: { provider: 'openrouter', model: 'finto/secondo', sort: 'price' },
        terzo: { provider: 'openrouter', model: 'finto/terzo' },
      },
      models: { [A.EXPLAIN]: 'primo,secondo,terzo' },
    });
  });
  await generaleA(app, 'throughput');
  await intercetta(app);
  const attesa = await listaAttesa(app);
  expect(attesa.length, 'la politica sui fornitori deve avere una lista non vuota').toBeGreaterThan(0);

  const page = await openTab(PAGINA);
  await page.waitForTimeout(400);
  const esito = await page.evaluate(async () => window.filo.message({
    type: 'ai_request',
    action: 'explain',
    payload: { messages: [{ role: 'user', content: 'fila di modelli ' + Date.now() }] },
  }));
  expect(esito && esito.ok, `la fila non è arrivata in fondo: ${JSON.stringify(esito)}`).toBeTruthy();

  const viste = await app.evaluate(async () => globalThis.__richieste
    .filter((r) => r.url.includes('/chat/completions'))
    .map((r) => ({ model: r.corpo && r.corpo.model, provider: r.corpo && r.corpo.provider })));

  const perModello = (m) => viste.find((r) => String(r.model || '').includes(m));
  for (const [modello, criterio] of [['finto/primo', 'latency'], ['finto/secondo', 'price'], ['finto/terzo', 'throughput']]) {
    const r = perModello(modello);
    expect(r, `il modello ${modello} non è mai stato chiamato`).toBeTruthy();
    expect(r.provider, `${modello}: nessuna istruzione di routing nella richiesta`).toBeTruthy();
    expect(r.provider.sort, `${modello}: chiama con un criterio che non è il suo`).toBe(criterio);
    expect(r.provider.ignore, `${modello}: la lista dei fornitori esclusi non è la stessa`).toEqual(attesa);
  }
});
