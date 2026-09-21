// Modelli predefiniti: l'ordinamento degli host si sceglie per modello, accanto al reasoning.
// Dalla riga dell'owner fino alla richiesta che parte: il `sort` della voce arriva al router,
// e la lista di esclusione viaggia identica per i modelli con e senza ordinamento.

import { test, expect } from './fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

const REGISTRY = {
  'deepseek-flash': { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', weights: 'open', reasoning: 'low' },
  'gemma-lite': { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it', weights: 'open' },
};

// La pagina vuole un admin loggato, che nei test non c'è: il main è finto, e ricorda
// l'ultimo salvataggio nella scheda così una riapertura ritrova quello che è stato scritto.
async function openEditor(openTab) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((registry) => {
    const salvato = () => {
      try { return JSON.parse(sessionStorage.getItem('__registry') || 'null'); } catch (_) { return null; }
    };
    const config = () => ({
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: salvato() || registry,
      models: {},
      excludedProviders: (window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [],
    });
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      if (msg.type === 'defaults_get') return { ok: true, config: config() };
      if (msg.type === 'defaults_update') {
        if (msg.config && msg.config.modelRegistry) {
          sessionStorage.setItem('__registry', JSON.stringify(msg.config.modelRegistry));
        }
        return { ok: true, config: config() };
      }
      if (msg.type === 'test_default_model') return { ok: true, ttftMs: 100, tokensPerSec: 50 };
      if (msg.type === 'default_models_list') return { ok: true, provider: msg.provider, items: [] };
      return { ok: true };
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, REGISTRY);
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

const riga = (page, nick) => page
  .locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)')
  .filter({ has: page.locator(`.sn-model-nick[value="${nick}"]`) });

test('scelgo l’ordinamento su una riga, salvo, riapro: è ancora lì, e la richiesta di quel modello lo porta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openEditor(openTab);

  const svelto = riga(page, 'deepseek-flash');
  const sort = svelto.locator('.sn-model-sort');
  await expect(sort).toBeVisible();
  await expect(sort).toHaveValue('auto');
  await expect(sort.locator('option')).toHaveText(['Automatico', 'Più veloce', 'Risposta più pronta', 'Più economico']);
  // Gemello del select del reasoning: stesso aspetto, e un hover di una riga.
  const stile = (loc) => loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.fontSize, s.color, s.backgroundColor, s.borderTopColor, s.height].join('|');
  });
  expect(await stile(sort)).toBe(await stile(svelto.locator('.sn-model-reason')));
  expect((await sort.getAttribute('title')) || '').not.toBe('');

  await sort.selectOption('throughput');

  // Il «Prova» della riga non ancora salvata gira già con quello che c'è scritto.
  await svelto.getByRole('button', { name: 'Prova' }).click();
  const prova = await page.evaluate(() => window.__sent.filter((m) => m.type === 'test_default_model').pop());
  expect(prova.sort).toBe('throughput');
  expect(prova.reasoning).toBe('low');

  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd.config.modelRegistry['deepseek-flash'].sort).toBe('throughput');
  expect(upd.config.modelRegistry['deepseek-flash'].reasoning).toBe('low');
  expect('sort' in upd.config.modelRegistry['gemma-lite']).toBe(false);

  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  await expect(riga(page, 'deepseek-flash').locator('.sn-model-sort')).toHaveValue('throughput');
  await expect(riga(page, 'gemma-lite').locator('.sn-model-sort')).toHaveValue('auto');

  // Si può togliere: tornando su Automatico il campo sparisce dalla voce salvata.
  await riga(page, 'deepseek-flash').locator('.sn-model-sort').selectOption('auto');
  await page.click('#saveBtn');
  const tolto = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect('sort' in tolto.config.modelRegistry['deepseek-flash']).toBe(false);

  // Dal salvataggio alla richiesta vera: nel main sono finti solo la rete (il documento
  // condiviso e il router), tutto il resto è il cammino che fa Filo.
  const esito = await app.evaluate(async (_electron, registry) => {
    const C = globalThis.SN_CONST;
    const H = globalThis.__filoHandlers;
    const Defaults = globalThis.__filoDefaults;
    const vero = global.fetch;
    let doc = {};
    const corpi = [];
    const json = (obj, status = 200) => ({
      ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj), clone() { return this; },
    });
    global.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/config/models')) {
        if (init && init.method === 'PATCH') { doc = { ...doc, ...JSON.parse(init.body).fields }; return json({}); }
        return json({ fields: doc });
      }
      if (u.includes('/chat/completions')) {
        corpi.push(JSON.parse(init.body));
        return json({ choices: [{ message: { content: 'Una spiegazione.' } }], usage: {}, provider: 'Fireworks' });
      }
      return json({}, 404);
    };
    try {
      await Defaults.update({ modelRegistry: registry }, 'gettone-finto');
      await Defaults.refresh();
      await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, apiKeys: { openrouter: 'k-test' } });
      const settings = await H.getEffectiveSettings();
      const catena = H.buildAttemptChain(settings, 'deepseek-flash, gemma-lite', C.ACTIONS.EXPLAIN);
      let errore = null;
      try {
        await H.handleAIRequest({
          action: C.ACTIONS.EXPLAIN, payload: { selection: 'ciao', sentence: 'ciao mondo' }, origin: 'test', noCache: true,
        });
      } catch (e) { errore = String((e && e.message) || e); }
      return {
        errore,
        letto: Defaults.get().modelRegistry['deepseek-flash'],
        catena: catena.map((a) => ({ model: a.model, routing: a.providerRouting, reasoning: a.reasoning })),
        corpo: corpi[0] || null,
        ignoreAtteso: C.providerIgnoreList(settings.excludedProviders),
      };
    } finally {
      global.fetch = vero;
    }
  }, upd.config.modelRegistry);

  expect(esito.errore).toBeNull();
  expect(esito.letto.sort).toBe('throughput');
  expect(esito.corpo.model).toBe('deepseek/deepseek-v4-flash');
  expect(esito.corpo.provider.sort).toBe('throughput');
  expect(esito.corpo.reasoning).toEqual({ effort: 'low' });
  // La politica sui fornitori non si sposta di una virgola.
  expect(esito.ignoreAtteso.length).toBeGreaterThan(0);
  expect(esito.corpo.provider.ignore).toEqual(esito.ignoreAtteso);
  const [conSort, senzaSort] = esito.catena;
  expect(conSort.routing).toEqual({ ignore: esito.ignoreAtteso, sort: 'throughput' });
  expect(senzaSort.routing).toEqual({ ignore: esito.ignoreAtteso });
});
