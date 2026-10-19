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
      globalThis.__corpi.push({ u, corpo });
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
  const r = await app.evaluate(async () => globalThis.__filoHandlers.executeFiloAction(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'ordine_host', valore: 'velocità' }, { confirmed: true }));
  console.log('ESEGUI', JSON.stringify(r));
  await expect(page.locator('#ordineHost')).toHaveValue('throughput', { timeout: 5_000 });
  const salvato = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).ordineHost);
  expect(salvato).toBe('throughput');
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });
  const sorts = await app.evaluate(() => globalThis.__corpi.filter((c) => c.u.includes('/chat/')).map((c) => c.corpo && c.corpo.provider));
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
