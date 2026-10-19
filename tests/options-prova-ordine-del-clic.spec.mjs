// La misura del «Prova» nelle Opzioni va all'ordinamento degli host con cui la prova è partita, e la chiamata
// usa proprio quello: cambiare la tendina mentre la prova gira non deve mettere i numeri sotto un'altra scelta (#1121).

import { test, expect } from './fixtures/electron.mjs';

async function finguiOpenRouter(app, settings) {
  await app.evaluate(async (_e, settings) => {
    globalThis.__prove = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        let corpo = null;
        try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
        if (JSON.stringify((corpo && corpo.messages) || []).includes('Conta da 1 a 20')) {
          globalThis.__prove.push({ sort: corpo.provider ? corpo.provider.sort || '' : '', model: corpo.model });
          await new Promise((ok) => setTimeout(ok, 2000));
        }
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await globalThis.SN_STORAGE.updateSettings(settings);
  }, settings);
}

test('modello proprio: cambiando «Host dei modelli» mentre il «Prova» gira, la misura resta a «Più economico»', async ({ app, openTab }) => {
  await finguiOpenRouter(app, {
    useDefaultModels: false, openWeightsOnly: false, ordineHost: 'price', apiKeys: { openrouter: 'sk-or-finta' },
    modelRegistry: { mio: { provider: 'openrouter', model: 'vendor/uno' } },
  });
  const page = await openTab('filo://options/options.html');
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });
  await expect(page.locator('#ordineHost')).toHaveValue('price');

  await riga.locator('.sn-model-test').click();
  await expect.poll(() => app.evaluate(() => globalThis.__prove.length), { timeout: 10_000 }).toBe(1);
  await page.selectOption('#ordineHost', 'throughput');
  expect(await app.evaluate(() => globalThis.__prove[0].sort)).toBe('price');

  // Il pulsante torna premibile solo a prova finita: da lì, sotto «Più veloce» non deve leggersi la misura.
  await expect(riga.locator('.sn-model-test')).toBeDisabled();
  await expect(riga.locator('.sn-model-test')).toBeEnabled({ timeout: 10_000 });
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/Non ancora testato/);
  await page.selectOption('#ordineHost', 'price');
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 5_000 });
});

test('modello proprio con un ordinamento suo: la prova chiama con quello, non con la scelta generale', async ({ app, openTab }) => {
  await finguiOpenRouter(app, {
    useDefaultModels: false, openWeightsOnly: false, ordineHost: 'price', apiKeys: { openrouter: 'sk-or-finta' },
    modelRegistry: { mio: { provider: 'openrouter', model: 'vendor/uno', sort: 'latency' } },
  });
  const page = await openTab('filo://options/options.html');
  const riga = page.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });

  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 10_000 });
  expect(await app.evaluate(() => globalThis.__prove.map((p) => p.sort))).toEqual(['latency']);
  // La tendina generale non tocca una riga che ha l'ordinamento suo: la misura resta.
  await page.selectOption('#ordineHost', 'throughput');
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/);
});
