// #1121 giro 1: nelle Opzioni la misura del «Prova» va a nome della scelta degli host con cui è stata presa,
// non di quella che c'è quando la risposta torna.

import { test, expect } from '../../fixtures/electron.mjs';

test('r1 cambiando «Host dei modelli» mentre il «Prova» gira, la misura presa con «Più economico» non si mostra sotto «Più veloce»', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    globalThis.__sortProve = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        let corpo = null;
        try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
        if (JSON.stringify((corpo && corpo.messages) || []).includes('Conta da 1 a 20')) {
          globalThis.__sortProve.push(corpo.provider ? corpo.provider.sort || '' : '');
          // Un modello vero ci mette qualche secondo: il tempo di cambiare idea sulla tendina.
          await new Promise((ok) => setTimeout(ok, 2500));
        }
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true, openWeightsOnly: false, ordineHost: 'price', apiKeys: { openrouter: 'sk-or-finta' },
    });
  });

  const page = await openTab('filo://options/options.html');
  const riga = page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });
  await expect(page.locator('#ordineHost')).toHaveValue('price');

  await riga.locator('.sn-model-test').click();
  await expect.poll(() => app.evaluate(() => globalThis.__sortProve.length), { timeout: 10_000 }).toBe(1);
  await page.selectOption('#ordineHost', 'throughput');

  // La prova è partita con «Più economico».
  expect(await app.evaluate(() => globalThis.__sortProve[0])).toBe('price');
  await page.waitForTimeout(4_000);
  await expect(riga.locator('.sn-model-row-status'), 'sotto «Più veloce» si legge una misura presa con «Più economico»')
    .not.toHaveText(/TTFT\s+\d/);

  // Riportata la tendina su «Più economico», la misura è lì: è sua.
  await page.selectOption('#ordineHost', 'price');
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 5_000 });
});
