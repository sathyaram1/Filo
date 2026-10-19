// #1121 giro 2: esplorazione (si cancella prima di registrare).
import { test, expect } from '../../fixtures/electron.mjs';

const OPZ = 'filo://options/options.html';

async function fintoRouter(app) {
  await app.evaluate(async () => {
    globalThis.__corpi = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__corpi.push({ u, corpo, dopo: !!globalThis.__dopo, m: corpo && corpo.model, primo: JSON.stringify((corpo && corpo.messages) || []).slice(0, 120) });
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

test('chat cambia gli host: la tendina delle Opzioni aperta si riallinea e la prova chiama con quello', async ({ app, openTab }) => {
  await fintoRouter(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, openWeightsOnly: false, ordineHost: '', apiKeys: { openrouter: 'sk-or-finta' } });
  });
  const page = await openTab(OPZ);
  const riga = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });
  await app.evaluate(() => { globalThis.__dopo = true; });
  const r = await app.evaluate(async () => globalThis.__filoHandlers.executeFiloAction(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'ordine_host', valore: 'velocità' }, { confirmed: true }));
  console.log('ESEGUI', JSON.stringify(r));
  await expect(page.locator('#ordineHost')).toHaveValue('throughput', { timeout: 5_000 });
  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).ordineHost);
  expect(salvato).toBe('throughput');
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });
  const sorts = await app.evaluate(() => globalThis.__corpi.filter((c) => c.u.includes('/chat/')).map((c) => ({ dopo: c.dopo, m: c.m, p: c.corpo && c.corpo.provider && c.corpo.provider.sort, primo: c.primo })));
  console.log('PROVIDER', JSON.stringify(sorts));
  // Ora una richiesta vera della chat
  const eff = await app.evaluate(async () => {
    const H = globalThis.__filoHandlers;
    const s = await H.getEffectiveSettings();
    const ch = await H.buildAttemptChain(s, globalThis.SN_CONST.ACTIONS.EXPLAIN);
    return ch.map((a) => ({ m: a.model, r: a.providerRouting }));
  }).catch((e) => 'ERR ' + e.message);
  console.log('CATENA', JSON.stringify(eff));
});

for (const tema of ['light', 'dark']) {
  for (const def of [true, false]) {
    test(`aspetto opzioni ${tema} predefiniti=${def}`, async ({ app, openTab }) => {
      await app.evaluate(async (_e, o) => {
        await globalThis.SN_STORAGE.updateSettings({ theme: o.tema, useDefaultModels: o.def, ordineHost: 'throughput', apiKeys: { openrouter: 'sk-or-finta' },
          modelRegistry: { mio: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } } });
      }, { tema, def });
      const page = await openTab(OPZ);
      await page.waitForTimeout(2500);
      const box = await page.locator('#ordineHost').boundingBox();
      console.log(tema, def, 'BOX', JSON.stringify(box), 'VIS', await page.locator('#ordineHost').isVisible());
      const opts = await page.locator('#ordineHost option').allTextContents();
      console.log('OPZIONI', JSON.stringify(opts));
      await page.locator('#ordineHost').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `tests/.shots/1121g2-opzioni-${tema}-${def}.png` });
    });
  }
}

async function rallenta(page) {
  await page.evaluate(() => {
    window.__log = [];
    const vero = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (msg, ...r) => {
      if (msg && msg.settings) {
        const t0 = performance.now();
        window.__log.push(['parte', JSON.stringify(msg.settings).slice(0, 80), Math.round(t0)]);
        await new Promise((ok) => setTimeout(ok, 2500));
        const res = await vero(msg, ...r);
        window.__log.push(['arriva', JSON.stringify(msg.settings).slice(0, 80), Math.round(performance.now())]);
        return res;
      }
      return vero(msg, ...r);
    };
    window.__hint = [];
    const h = document.getElementById('savedHint');
    new MutationObserver(() => window.__hint.push([h.classList.contains('sn-show'), Math.round(performance.now()), h.textContent])).observe(h, { attributes: true, attributeFilter: ['class'] });
  });
}

for (const [nome, url, id, a, b] of [
  ['preferenze', 'filo://preferences/preferences.html', 'agentStyleText', 'primo', 'secondo testo'],
  ['opzioni', 'filo://options/options.html', 'monthlyLimit', '7', '9'],
]) {
  test(`in viaggio: ${nome}`, async ({ openTab }) => {
    const page = await openTab(url);
    await page.waitForSelector('#' + id, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await rallenta(page);
    const scrivi = (t) => page.evaluate(([i, v]) => { const el = document.getElementById(i); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, t]);
    await scrivi(a);
    await expect.poll(() => page.evaluate(() => window.__log.length), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await scrivi(b);
    await page.waitForTimeout(9000);
    console.log(nome, 'LOG', JSON.stringify(await page.evaluate(() => window.__log)));
    console.log(nome, 'HINT', JSON.stringify(await page.evaluate(() => window.__hint)));
  });
}

test('aspetto admin', async ({ app, openTab }) => {
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  await page.addInitScript(() => {
    const config = () => ({ apiKeysPresent: { openrouter: true, tavily: false }, safeBrowsingKeyPresent: false, providerSort: 'throughput',
      modelRegistry: { 'deepseek-flash': { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', reasoning: 'low', sort: 'latency' }, 'gemma': { provider: 'openrouter', model: 'google/gemma-4-26b-a4b-it' } },
      models: {}, excludedProviders: [] });
    const stub = async (msg) => {
      if (msg.type === 'defaults_get') return { ok: true, config: config() };
      if (msg.type === 'defaults_update') return { ok: true, config: config() };
      if (msg.type === 'test_default_model') { await new Promise((r) => setTimeout(r, 300)); return { ok: true, ttftMs: 100, tokensPerSec: 50 }; }
      if (msg.type === 'default_models_list') return { ok: true, provider: msg.provider, items: [] };
      return window.__veroSend ? window.__veroSend(msg) : { ok: true };
    };
    window.__veroSend = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
    window.chrome.runtime.sendMessage = stub;
  });
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  const r = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await r.getByRole('button', { name: 'Prova' }).click();
  await page.waitForTimeout(800);
  await r.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/1121g2-admin.png' });
  await page.locator('#providerSort').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/1121g2-admin-generale.png' });
});
