process.env.FILO_DEFAULT_OPENROUTER_KEY = 'k-test-openrouter';
process.env.FILO_DEFAULT_GEMINI_KEY = 'k-test-gemini';
import { test } from './fixtures/electron.mjs';

test('debug', async ({ app, shell }) => {
  await shell.waitForLoadState('domcontentloaded');
  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const Storage = globalThis.SN_STORAGE;
    await Storage.setSettings({ useDefaultModels: true, openWeightsOnly: false });
    const s = await globalThis.SN_GET_EFFECTIVE_SETTINGS?.();
    return {
      hasGetEff: typeof globalThis.SN_GET_EFFECTIVE_SETTINGS,
      providerTestModels: s && s.models && s.models[C.ACTIONS.PROVIDER_TEST],
      regKeys: s && Object.keys(s.modelRegistry || {}).slice(0, 40),
      entry: s && s.modelRegistry && s.modelRegistry['flash-lite-3'],
    };
  });
  console.log(JSON.stringify(out, null, 2));
});
