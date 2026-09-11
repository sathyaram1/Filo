import { test, expect } from './fixtures/electron.mjs';

test('probe: indipendenza del modello, dal vero', async ({ app }) => {
  test.setTimeout(60_000);
  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.GUARD_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const s = await globalThis.SN_STORAGE.getSettings();
    return {
      chat: s.models[C.ACTIONS.FILO_CHAT],
      guard: s.models[C.ACTIONS.GUARD_TEXT],
      useDefault: s.useDefaultModels,
    };
  });
  console.log('SETTINGS:', JSON.stringify(out));

  const esito = await app.evaluate(async () => {
    const TG = globalThis.SN_TEXT_GUARDIAN;
    // Ricablo il guardiano sul suo vero eseguiModello (quello del main).
    const H = globalThis.SN_WIRE_TEXT_GUARDIAN;
    if (H) H();
    return TG.controllaTesto({
      testo: 'Un testo qualunque nato da una pagina.',
      fiducia: 'contaminato',
      origine: 'una ricerca sul web',
      produttore: 'deepseek-flash',
    });
  });
  console.log('ESITO con stesso modello:', JSON.stringify(esito));
  expect(true).toBe(true);
});
