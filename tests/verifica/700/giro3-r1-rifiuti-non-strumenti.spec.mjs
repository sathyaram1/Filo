// #700 giro 3: un rifiuto del router che non riguarda gli strumenti (fornitori esclusi dai filtri, modello ritirato)
// non va raccontato all'utente come «nessun fornitore sa usare gli strumenti».

import { test, expect } from '../../fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function routerCheRifiuta(app, rifiuto) {
  await app.evaluate(async (_e, rifiuto) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__corpi700 = [];
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      globalThis.__corpi700.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ error: { code: 404, message: rifiuto } }), { status: 404, headers: { 'content-type': 'application/json' } });
    };
  }, rifiuto);
}

const CASI = [
  ['i fornitori del modello sono tutti esclusi dai filtri', 'No allowed providers are available for the selected model.'],
  ['il modello non ha più nessun host sul router', 'No endpoints found for deepseek/deepseek-v4-flash.'],
];

for (const [nome, rifiuto] of CASI) {
  test(`${nome}: la chat non dice che il modello non sa usare gli strumenti`, async ({ app, shell }) => {
    test.setTimeout(60_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#input')).toBeVisible();
    await routerCheRifiuta(app, rifiuto);

    await page.locator('#input').fill('che ore sono a Tokyo?');
    await page.locator('#sendBtn').click();
    const bolla = page.locator('.dash-bubble-filo', { hasText: /fornitor|modell/i }).last();
    await expect(bolla).toBeVisible({ timeout: 15_000 });
    await expect(bolla).not.toContainText('strumenti');
  });
}
