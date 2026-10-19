// #1121 giro 2: la misura di un «Prova» resta anche se un'altra pagina aperta prima ne prende una dopo.

import { test, expect } from '../../fixtures/electron.mjs';

async function fintoRouter(app) {
  await app.evaluate(async () => {
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai/')) return vero(url, init);
      if (u.includes('/chat/completions')) {
        const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"completion_tokens":9}}\n\n'
          + 'data: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: true, openWeightsOnly: false, ordineHost: '', apiKeys: { openrouter: 'sk-or-finta' }, defaultModelTests: {},
    });
  });
}

const righe = (page) => page.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)');

test('r1 due schede delle Opzioni aperte: la misura presa nella seconda non cancella quella presa nella prima', async ({ app, openTab }) => {
  await fintoRouter(app);
  const prima = await openTab('filo://options/options.html');
  await righe(prima).first().waitFor({ timeout: 15_000 });
  const seconda = await openTab('filo://options/options.html');
  await righe(seconda).nth(1).waitFor({ timeout: 15_000 });

  await righe(prima).first().locator('.sn-model-test').click();
  await expect(righe(prima).first().locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });
  await righe(seconda).nth(1).locator('.sn-model-test').click();
  await expect(righe(seconda).nth(1).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });
  await prima.waitForTimeout(500);

  const salvate = await app.evaluate(async () => Object.keys((await globalThis.SN_STORAGE.getSettings()).defaultModelTests || {}));
  expect(salvate.length, `misure rimaste: ${JSON.stringify(salvate)}`).toBe(2);

  // Riaperte le Opzioni, si vedono tutte e due.
  await prima.reload();
  await righe(prima).nth(1).waitFor({ timeout: 15_000 });
  await expect(righe(prima).first().locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 5_000 });
  await expect(righe(prima).nth(1).locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 5_000 });
});
