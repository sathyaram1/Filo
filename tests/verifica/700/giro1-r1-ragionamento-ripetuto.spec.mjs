// #700 giro 1: con un modello i cui host non reggono il ragionamento, il rifiuto del router si
// paga una volta, non a ogni richiesta: dal secondo messaggio la chat va dritta.

import { test, expect } from '../../fixtures/electron.mjs';

const NO_PARAMS = 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('il secondo messaggio non ripete la richiesta rifiutata per il ragionamento', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async (_e, rifiuto) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__corpi = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const body = JSON.parse(init.body);
      globalThis.__corpi.push({ reasoning: !!body.reasoning, tools: Array.isArray(body.tools) && body.tools.length > 0 });
      if (body.tools && body.reasoning) {
        return new Response(JSON.stringify({ error: { code: 404, message: rifiuto } }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, NO_PARAMS);

  const risposte = page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' });
  await page.locator('#input').fill('che ore sono a Tokyo?');
  await page.locator('#sendBtn').click();
  await expect(risposte).toHaveCount(1, { timeout: 15_000 });
  await page.locator('#input').fill('e a Lima?');
  await page.locator('#sendBtn').click();
  await expect(risposte).toHaveCount(2, { timeout: 15_000 });

  const corpi = await app.evaluate(() => globalThis.__corpi.filter((b) => b.tools));
  // Due messaggi: il primo paga il rifiuto e il rifacimento, il secondo una richiesta sola.
  expect(corpi.filter((b) => b.reasoning)).toHaveLength(1);
  expect(corpi).toHaveLength(3);
});
