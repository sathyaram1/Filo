import { test, expect } from './fixtures/electron.mjs';
test('debug', async ({ app, openTab }) => {
  await app.evaluate(async ({ modelId }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, lettura: { label: 'Lettura', provider: 'openrouter', model: modelId, inputs: ['text'], outputs: ['audio'] } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.TTS]: 'lettura' },
      tts: { modelVoice: '', rate: 1, pitch: 1, voice: '' },
    });
  }, { modelId: 'microsoft/mai-voice-2' });
  const p = await openTab('filo://preferences/preferences.html');
  await p.waitForTimeout(1000);
  const info = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_voices' }));
  console.log('INFO', JSON.stringify(info));
  const s = await app.evaluate(async () => { const s = await globalThis.SN_STORAGE.getSettings(); return { models: s.models, reg: Object.keys(s.modelRegistry||{}), udm: s.useDefaultModels, keys: Object.keys(s.apiKeys||{}) }; });
  console.log('SETTINGS', JSON.stringify(s));
  const r = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'ciao', lang: 'it' }));
  console.log('SYNTH', JSON.stringify(r).slice(0, 300));
});
