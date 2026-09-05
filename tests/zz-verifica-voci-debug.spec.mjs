import { test, expect } from './fixtures/electron.mjs';
test('debug', async ({ app, openTab }) => {
  const out = await app.evaluate(async ({ modelId }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, lettura: { label: 'Lettura', provider: 'openrouter', model: modelId, inputs: ['text'], outputs: ['audio'] } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.TTS]: 'lettura' },
      tts: { modelVoice: '', rate: 1, pitch: 1, voice: '' },
    });
    const s = await globalThis.SN_STORAGE.getSettings();
    return { key: s.apiKeys.openrouter, lettura: s.modelRegistry.lettura, kokoro: s.modelRegistry.kokoro };
  }, { modelId: 'microsoft/mai-voice-2' });
  console.log('OUT', JSON.stringify(out));
});
