import { test, expect } from './fixtures/electron.mjs';

test('debug fixture in pagina opzioni', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  const info = await page.evaluate(async () => {
    const s = await window.SN_STORAGE.getSettings();
    const C = window.SN_CONST;
    const e = (s.modelRegistry || {})['deepseek-flash'];
    return {
      hasFixture: !!window.SN_TEST_MODELS,
      entry: e,
      meta: e ? C.entryModalities(e, 'deepseek-flash') : null,
      match: e ? window.SN_MODEL_CAPS.modelMatchesAction(e.provider, e.model, C.ACTIONS.TTS, C.entryModalities(e, 'deepseek-flash') || undefined) : null,
      ttsChain: s.models[C.ACTIONS.TTS],
    };
  });
  console.log('INFO', JSON.stringify(info));
  expect(true).toBe(true);
});
