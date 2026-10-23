// Verifica #1509.1 giro 1, rilievo 3: la prima risposta su una pagina compare subito, come le successive (prima di
// questo lavoro, nel documento, compariva in poche decine di millisecondi).
import { test, expect } from '../../fixtures/electron.mjs';
import { conta } from '../../helpers/riquadri.mjs';

test('r3 la prima traduzione su una pagina appena aperta compare entro 200 ms', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
  const p = await testServer.openReady(openTab, '<!doctype html><body style="padding:40px;font:20px sans-serif"><p>Il <span id="parola">gatto</span> dorme.</p></body>');
  await p.locator('#parola').dblclick();
  const t0 = Date.now();
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs));
  });
  await expect.poll(() => conta(app, p, '.sn-popup'), { timeout: 15_000, intervals: [10] }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(200);
});
