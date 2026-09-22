// La misura del «Prova» vale per la configurazione con cui è stata presa: il
// giro scorso ha chiuso la porta del cambio di modello. Qui si prova l'altra
// porta della stessa causa: il modello resta su «Automatico» e a cambiare è la
// scelta generale degli host, cioè proprio quello che la misura misurava.

import { test, expect } from '../../fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    if (globalThis.__misuraGenAttivo) return;
    globalThis.__misuraGenAttivo = true;
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":9},"provider":"Baseten"}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

// Registry predefinito con UNA voce senza ordinamento proprio (resta su
// «Automatico»), e la scelta generale al valore chiesto.
async function predefinitiCon(app, generale) {
  await app.evaluate(async (_e, g) => {
    const D = globalThis.__filoDefaults;
    if (!globalThis.__getVeroMisura) globalThis.__getVeroMisura = D.get;
    D.get = (...a) => {
      const base = globalThis.__getVeroMisura(...a);
      return {
        ...base,
        providerSort: g,
        apiKeys: { ...(base.apiKeys || {}), openrouter: 'sk-or-finta-misura' },
        modelRegistry: { ...(base.modelRegistry || {}), misurato: { provider: 'openrouter', model: 'finto/misurato' } },
      };
    };
  }, generale);
}

async function rigaMisurato(page) {
  return page.evaluate(() => {
    const righe = Array.from(document.querySelectorAll('#defaultModelsList .sn-model-row'));
    const riga = righe.find((r) => (r.textContent || '').includes('finto/misurato'));
    if (!riga) return null;
    const stato = riga.querySelector('.sn-model-row-status');
    return (stato && stato.textContent) || '';
  });
}

test('cambiata la scelta generale degli host, la misura presa con quella di prima non resta a parlare di adesso', async ({ app, openTab, shell }) => {
  test.setTimeout(120_000);
  await predefinitiCon(app, 'price');
  await intercetta(app);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, openWeightsOnly: false });
  });

  const page = await openTab(OPZIONI);
  await page.waitForSelector('#defaultModelsList .sn-model-row', { timeout: 15_000 });

  // Prova sulla riga: la misura nasce con la scelta generale «più economico».
  const premuto = await page.evaluate(() => {
    const righe = Array.from(document.querySelectorAll('#defaultModelsList .sn-model-row'));
    const riga = righe.find((r) => (r.textContent || '').includes('finto/misurato'));
    if (!riga) return false;
    riga.querySelector('button').click();
    return true;
  });
  expect(premuto, 'la riga del modello predefinito di prova non compare nelle Opzioni').toBe(true);

  await expect.poll(() => rigaMisurato(page), { timeout: 20_000, message: 'la prova non ha prodotto una misura' })
    .toMatch(/TTFT/);
  const misura = await rigaMisurato(page);

  // L'owner cambia la scelta generale: da «più economico» a «più veloce».
  await predefinitiCon(app, 'throughput');
  await page.reload();
  await page.waitForSelector('#defaultModelsList .sn-model-row', { timeout: 15_000 });
  await page.waitForTimeout(500);

  const dopo = await rigaMisurato(page);
  expect(dopo,
    `la misura ${JSON.stringify(misura)} è stata presa con un altro criterio di scelta degli host e resta lì come se valesse ancora`)
    .not.toMatch(/TTFT/);
});
