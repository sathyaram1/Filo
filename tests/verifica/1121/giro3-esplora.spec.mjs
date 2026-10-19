// #1121 giro 3, esplorazione: la scelta personale «Host dei modelli» fatta dalle Opzioni arriva alla chat vera,
// sopra l'ordinamento che l'owner dà al modello predefinito, e la lista di esclusione resta quella.

import { test, expect } from '../../fixtures/electron.mjs';

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
      const json = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
      if (u.includes('/chat/completions')) {
        return json({ id: 'gen-finta', provider: 'Baseten', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      if (u.includes('/models')) return json({ data: [] });
      return json({ data: {} });
    };
  });
}

async function predefinitiConSort(app, sort) {
  await app.evaluate(async (_e, s) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVero) globalThis.__getVero = D.get;
    D.get = (...a) => {
      const v = globalThis.__getVero(...a);
      const A = globalThis.SN_CONST.ACTIONS;
      return {
        ...v,
        models: { ...(v.models || {}), [A.EXPLAIN]: 'esplora-chat' },
        modelRegistry: { ...(v.modelRegistry || {}), 'esplora-chat': { provider: 'openrouter', model: 'finto/chat', ...(s ? { sort: s } : {}) } },
      };
    };
  }, sort);
}

async function chiedi(page) {
  return page.evaluate(async () => window.filo.message({
    type: 'ai_request', action: 'explain',
    payload: { messages: [{ role: 'user', content: `esplora ${Date.now()}` }] },
  }));
}

const ultimaChat = (app) => app.evaluate(() => {
  const c = globalThis.__richieste.filter((r) => r.url.includes('/chat/completions'));
  return c.length ? c[c.length - 1].corpo.provider : null;
});

test('la scelta delle Opzioni arriva alla chat e vince su quella del modello predefinito', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, openWeightsOnly: false, ordineHost: '', apiKeys: { openrouter: 'sk-or-finta' } });
  });
  await predefinitiConSort(app, 'latency');
  await intercetta(app);
  const attesa = await app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return globalThis.SN_CONST.providerIgnoreList(s.excludedProviders || []);
  });

  const opz = await openTab('filo://options/options.html');
  await expect(opz.locator('#ordineHost')).toHaveValue('');
  const dash = await openTab('filo://dashboard/dashboard.html');

  let r = await chiedi(dash);
  expect(r && r.ok, JSON.stringify(r)).toBeTruthy();
  let p = await ultimaChat(app);
  expect(p.sort, 'senza scelta personale vale quella dell\'owner sul modello').toBe('latency');
  expect(p.ignore).toEqual(attesa);

  await opz.bringToFront();
  await opz.selectOption('#ordineHost', 'price');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).ordineHost), { timeout: 10_000 }).toBe('price');

  r = await chiedi(dash);
  expect(r && r.ok, JSON.stringify(r)).toBeTruthy();
  p = await ultimaChat(app);
  expect(p.sort, 'la scelta personale non arriva alla chat').toBe('price');
  expect(p.ignore).toEqual(attesa);

  await opz.selectOption('#ordineHost', '');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).ordineHost), { timeout: 10_000 }).toBe('');
  r = await chiedi(dash);
  p = await ultimaChat(app);
  expect(p.sort, 'tornato su «Lo sceglie Filo» resta l\'ordinamento dell\'owner').toBe('latency');

  await opz.reload();
  await expect(opz.locator('#ordineHost')).toHaveValue('');
});

test('la scelta cambiata da fuori (a parole) si vede nella pagina Opzioni già aperta', async ({ app, openTab }) => {
  const opz = await openTab('filo://options/options.html');
  await expect(opz.locator('#ordineHost')).toHaveValue('');
  await app.evaluate(async () => {
    const b = globalThis.SN_PREF.buildPreferencePartial('host dei modelli', 'voglio la chat più veloce');
    await globalThis.SN_STORAGE.updateSettings(b.partial);
  });
  await expect(opz.locator('#ordineHost')).toHaveValue('throughput', { timeout: 10_000 });
  await opz.screenshot({ path: 'tests/.shots/1121-giro3-opzioni.png', fullPage: false });
});
