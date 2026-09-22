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

// Il nome sta nella proprietà `value` del campo, non nell'attributo: la riga si trova per posizione.
async function riga(page, nick) {
  const righe = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const nomi = await righe.locator('.sn-model-nick').evaluateAll((els) => els.map((el) => el.value));
  expect(nomi).toContain(nick);
  return righe.nth(nomi.indexOf(nick));
}

test('scelgo l’ordinamento su una riga, salvo, riapro: è ancora lì, e la richiesta di quel modello lo porta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openEditor(openTab);

  const svelto = await riga(page, 'deepseek-flash');
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
  await expect((await riga(page, 'deepseek-flash')).locator('.sn-model-sort')).toHaveValue('throughput');
  await expect((await riga(page, 'gemma-lite')).locator('.sn-model-sort')).toHaveValue('auto');

  // Si può togliere: tornando su Automatico il campo sparisce dalla voce salvata.
  await (await riga(page, 'deepseek-flash')).locator('.sn-model-sort').selectOption('auto');
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
    let rifiutaIlPrimo = false;
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
        const corpo = JSON.parse(init.body);
        corpi.push(corpo);
        if (rifiutaIlPrimo && corpo.model === 'deepseek/deepseek-v4-flash') {
          return json({ error: { message: 'No endpoints found' } }, 404);
        }
        return json({ choices: [{ message: { content: 'Una spiegazione.' } }], usage: {}, provider: 'Fireworks' });
      }
      return json({}, 404);
    };
    try {
      await Defaults.update({ modelRegistry: registry }, 'gettone-finto');
      await Defaults.refresh();
      await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, apiKeys: { openrouter: 'k-test' } });
      const settings = await H.getEffectiveSettings();
      let errore = null;
      try {
        await H.handleAIRequest({
          action: C.ACTIONS.EXPLAIN, payload: { selection: 'ciao', sentence: 'ciao mondo' }, origin: 'test', noCache: true,
        });
        // Secondo giro: il primo modello cade, risponde quello senza ordinamento suo.
        rifiutaIlPrimo = true;
        await H.handleAIRequest({
          action: C.ACTIONS.EXPLAIN, payload: { selection: 'salve', sentence: 'salve a tutti' }, origin: 'test', noCache: true,
        });
      } catch (e) { errore = String((e && e.message) || e); }
      return {
        errore,
        letto: Defaults.get().modelRegistry['deepseek-flash'],
        catena: settings.models[C.ACTIONS.EXPLAIN],
        corpo: corpi[0] || null,
        ripiego: corpi.find((c) => c.model === 'google/gemma-4-26b-a4b-it') || null,
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
  expect(esito.ripiego, `catena: ${esito.catena}`).not.toBeNull();
  expect(esito.ripiego.provider).toEqual({ ignore: esito.ignoreAtteso });
  expect('reasoning' in esito.ripiego).toBe(false);
});

// Ogni riga della lista è una griglia a sé, intestazione compresa: se le colonne
// dei pulsanti non hanno una misura fissa, l'intestazione vuota si stringe e le
// scritte scivolano sopra il controllo accanto.
test('le scritte in cima alle colonne stanno sopra il controllo che descrivono', async ({ openTab }) => {
  const page = await openEditor(openTab);
  const misura = await page.evaluate(() => {
    const testa = document.querySelector('#modelRegistryList .sn-model-row-head');
    const riga = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
    const celle = Array.from(testa.children)
      .map((c) => ({ testo: c.textContent.trim().toLowerCase(), x: c.getBoundingClientRect().x }));
    const box = (sel) => {
      const r = riga.querySelector(sel).getBoundingClientRect();
      return { x: r.x, fine: r.x + r.width };
    };
    return { celle, reason: box('.sn-model-reason'), sort: box('.sn-model-sort') };
  });
  const etichetta = (t) => misura.celle.find((c) => c.testo === t);
  const reasoning = etichetta('reasoning');
  const host = etichetta('host');
  expect(reasoning && host, 'intestazioni «reasoning» e «host» non trovate').toBeTruthy();

  const dove = `«reasoning» a ${Math.round(reasoning.x)}, «host» a ${Math.round(host.x)};`
    + ` ragionamento da ${Math.round(misura.reason.x)} a ${Math.round(misura.reason.fine)},`
    + ` ordinamento da ${Math.round(misura.sort.x)} a ${Math.round(misura.sort.fine)}`;
  const storte = [];
  if (!(reasoning.x >= misura.reason.x - 4 && reasoning.x < misura.reason.fine)) storte.push('«reasoning»');
  if (!(host.x >= misura.sort.x - 4 && host.x < misura.sort.fine)) storte.push('«host»');
  expect(storte, `scritte sopra la colonna sbagliata — ${dove}`).toEqual([]);
});

// «Automatico» su una riga rimanda alla scelta generale: se quella non si può
// vedere né cambiare da nessuna parte, la voce rimanda al nulla.
test('la scelta generale degli host si vede, si cambia e si salva', async ({ openTab }) => {
  const page = await openEditor(openTab);
  const generale = page.locator('#providerSort');
  await expect(generale).toBeVisible();
  const voci = await generale.locator('option').evaluateAll((els) => els.map((o) => o.value));
  expect(voci).toEqual(['auto', 'throughput', 'latency', 'price']);

  await generale.selectOption('price');
  await page.locator('#saveBtn').click();
  await expect.poll(async () => page.evaluate(() => {
    const u = window.__sent.filter((m) => m.type === 'defaults_update').pop();
    return u && u.config ? (u.config.providerSort ?? null) : null;
  }), { timeout: 8_000 }).toBe('price');

  // E si toglie: ciò che si mette si deve poter rimettere com'era.
  await generale.selectOption('auto');
  await page.locator('#saveBtn').click();
  await expect.poll(async () => page.evaluate(() => {
    const u = window.__sent.filter((m) => m.type === 'defaults_update').pop();
    return u && u.config ? (u.config.providerSort ?? null) : null;
  }), { timeout: 8_000 }).toBe('');
});

// Le sette colonne della riga hanno tutte una misura: la stringa del modello è
// l'unica elastica, e senza un minimo si riduceva a una fessura mentre i
// pulsanti uscivano dallo schermo appena la finestra non era larga.
test('a finestra stretta la riga resta usabile: la stringa del modello si legge e i pulsanti restano dentro', async ({ openTab }) => {
  const page = await openEditor(openTab);
  const misure = [];
  for (const larghezza of [1280, 1024, 900, 800, 720]) {
    await page.setViewportSize({ width: larghezza, height: 800 });
    await page.waitForTimeout(150);
    misure.push(await page.evaluate((w) => {
      const riga = document.querySelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
      const campo = riga.querySelector('.sn-model-id');
      const ultimo = Array.from(riga.querySelectorAll('button')).pop();
      return {
        larghezza: w,
        campoModello: Math.round(campo.getBoundingClientRect().width),
        oltreLoSchermo: Math.round(ultimo.getBoundingClientRect().right - document.documentElement.clientWidth),
      };
    }, larghezza));
  }
  const rotte = misure.filter((m) => m.campoModello < 60 || m.oltreLoSchermo > 0);
  expect(rotte, `larghezze in cui la riga non è più usabile: ${JSON.stringify(misure)}`).toEqual([]);
});
