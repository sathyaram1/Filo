import { test, expect } from './fixtures/electron.mjs';

test('probe: configurazione effettiva con i predefiniti condivisi', async ({ app, shell }) => {
  await shell.waitForTimeout(8000);
  const info = await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    const d = D.get();
    const s = await globalThis.SN_STORAGE.getSettings();
    return {
      dProvider: d.provider,
      useDefault: s.useDefaultModels,
      userProvider: s.provider,
      models: { tts: d.models.tts, ta: d.models.transcribe_audio, emb: d.models.archive_embed, explain: d.models.explain },
      registry: Object.keys(d.modelRegistry || {}),
      apiKeys: Object.keys(d.apiKeys || {}).filter((k) => d.apiKeys[k]),
      keyForProvider: !!(d.apiKeys && d.apiKeys[d.provider]),
      excluded: d.excludedProviders,
    };
  });
  console.log('PROBE', JSON.stringify(info, null, 1));
  expect(info).toBeTruthy();
});
