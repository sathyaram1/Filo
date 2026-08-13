process.env.FILO_DEFAULT_OPENROUTER_KEY = 'k-test-openrouter';
process.env.FILO_DEFAULT_GEMINI_KEY = 'k-test-gemini';
import { test } from './fixtures/electron.mjs';

test('debug', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const Storage = globalThis.SN_STORAGE;
    await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: false });
    const D = globalThis.SN_DEFAULTS;
    const d = D && D.get ? D.get() : null;
    return {
      hasDefaults: !!D,
      dRegKeys: d && d.modelRegistry ? Object.keys(d.modelRegistry) : null,
      dModelsProviderTest: d && d.models ? d.models[C.ACTIONS.PROVIDER_TEST] : null,
      dFlashLite3: d && d.modelRegistry ? d.modelRegistry['flash-lite-3'] : null,
    };
  });
  console.log('DEBUG=' + JSON.stringify(out));
});
