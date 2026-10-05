// #700 giro 2: un rifiuto del router per la politica sui dati dell'account (non per gli strumenti)
// non va raccontato come «nessun fornitore sa usare gli strumenti»: l'utente cambierebbe modello invano.

import { test, expect } from '../../fixtures/electron.mjs';

const PRIVACY = 'No endpoints found matching your data policy (Paid model training). Configure: https://openrouter.ai/settings/privacy';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

test('il rifiuto per la privacy dell\'account non viene spiegato come mancanza di strumenti', async ({ app, shell }) => {
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
    const vero = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      return new Response(JSON.stringify({ error: { code: 404, message: rifiuto } }), { status: 404, headers: { 'content-type': 'application/json' } });
    };
  }, PRIVACY);

  await page.locator('#input').fill('che ore sono a Tokyo?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText(/privacy|dati/i, { timeout: 15_000 });
  await expect(bolla).not.toContainText('sa usare gli strumenti');
});
