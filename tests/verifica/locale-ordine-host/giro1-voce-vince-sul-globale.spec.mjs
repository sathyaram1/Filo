// Verifica: la scelta dell'ordinamento sul singolo modello vince sul valore
// globale della configurazione condivisa; un modello che non sceglie segue il
// globale; la lista di esclusione non cambia mai per colpa dell'ordinamento.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://dashboard/dashboard.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__ordineHostAttivo) { globalThis.__richieste.length = 0; return; }
    globalThis.__ordineHostAttivo = true;
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

// Ordinamento globale della configurazione condivisa: non c'è una manopola che
// lo scriva, quindi lo si mette dove il codice lo legge.
async function globaleA(app, valore) {
  await app.evaluate(async (_elettrone, v) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVero) globalThis.__getVero = D.get;
    D.get = (...a) => ({ ...globalThis.__getVero(...a), providerSort: v });
  }, valore);
}

async function preparaModelli(app) {
  await app.evaluate(async () => {
    const A = globalThis.SN_CONST.ACTIONS;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'sk-or-finta-ordine-host' },
      modelRegistry: {
        'con-scelta': { provider: 'openrouter', model: 'finto/con-scelta', sort: 'throughput' },
        'senza-scelta': { provider: 'openrouter', model: 'finto/senza-scelta' },
      },
      models: { [A.EXPLAIN]: 'con-scelta', [A.TRANSLATE_SELECTION]: 'senza-scelta' },
    });
  });
}

test('la scelta del singolo modello vince sul globale, e chi non sceglie segue il globale', async ({ app, openTab }) => {
  await preparaModelli(app);
  await globaleA(app, 'price');
  await intercetta(app);
  const page = await openTab(PAGINA);
  await page.waitForTimeout(400);

  const attesa = await app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
  });

  const chiama = async (azione, testo) => {
    const r = await page.evaluate(async (arg) => window.filo.message({
      type: 'ai_request', action: arg.azione,
      payload: { messages: [{ role: 'user', content: arg.testo }] },
    }), { azione, testo });
    expect(r && r.ok, `${azione} fallita: ${JSON.stringify(r)}`).toBeTruthy();
    const viste = await app.evaluate(async () => {
      const ultima = globalThis.__richieste.filter((x) => x.url.includes('/chat/completions')).pop();
      return ultima ? { modello: ultima.corpo.model, provider: ultima.corpo.provider } : null;
    });
    expect(viste, `nessuna richiesta per ${azione}`).toBeTruthy();
    return viste;
  };

  const conScelta = await chiama('explain', 'con scelta ' + Date.now());
  expect(conScelta.modello).toBe('finto/con-scelta');
  expect(conScelta.provider.sort, 'la scelta del modello non ha vinto sul globale').toBe('throughput');
  expect(conScelta.provider.ignore).toEqual(attesa);

  const senzaScelta = await chiama('translate_selection', 'senza scelta ' + Date.now());
  expect(senzaScelta.modello).toBe('finto/senza-scelta');
  expect(senzaScelta.provider.sort, 'il modello senza scelta non segue il globale').toBe('price');
  expect(senzaScelta.provider.ignore).toEqual(attesa);
});

test('senza ordinamento, né sul modello né globale, la lista di esclusione parte lo stesso', async ({ app, openTab }) => {
  await preparaModelli(app);
  await globaleA(app, '');
  await intercetta(app);
  const page = await openTab(PAGINA);
  await page.waitForTimeout(400);

  const r = await page.evaluate(async () => window.filo.message({
    type: 'ai_request', action: 'translate_selection',
    payload: { messages: [{ role: 'user', content: 'nessun ordinamento ' + Date.now() }] },
  }));
  expect(r && r.ok, `chiamata fallita: ${JSON.stringify(r)}`).toBeTruthy();

  const ultima = await app.evaluate(async () => {
    const x = globalThis.__richieste.filter((q) => q.url.includes('/chat/completions')).pop();
    return x ? x.corpo.provider : null;
  });
  expect(ultima, 'blocco fornitori assente').toBeTruthy();
  expect(ultima.sort, 'nessuno ha chiesto un ordinamento: non se ne deve imporre uno').toBeUndefined();
  expect(Array.isArray(ultima.ignore) && ultima.ignore.length, 'lista di esclusione persa').toBeTruthy();
});
