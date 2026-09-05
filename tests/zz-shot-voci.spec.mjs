// Temporaneo: screenshot della tendina delle voci in Preferenze col modello
// MAI-Voice in uso (verifica visiva, non resta nel repo).
import { test, expect } from './fixtures/electron.mjs';

test('shot: voci per modello in Preferenze', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    const nick = C.parseModelRefs(T.models[C.ACTIONS.TTS])[0];
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...T.registry, [nick]: { provider: 'openrouter', model: 'microsoft/mai-voice-2' } },
      models: { ...T.models },
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: 'it-IT-DiegoNeural' },
    });
  });
  const page = await openTab('filo://preferences/preferences.html');
  const sel = page.locator('#ttsModelVoice');
  await expect.poll(() => sel.evaluate((s) => s.options.length), { timeout: 10_000 }).toBeGreaterThan(3);
  expect(await sel.inputValue()).toBe('it-IT-DiegoNeural');
  const section = page.locator('#ttsModelVoice').locator('xpath=ancestor::section[1]');
  const target = (await section.count()) ? section : page.locator('#ttsModelVoice').locator('xpath=..');
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: 'tests/agent/.out/voci/prefs-select.png' });
  await sel.selectOption('__custom__');
  await page.locator('#ttsModelVoiceCustom').fill('la-mia-voce');
  await expect(page.locator('#ttsModelVoiceCustom')).toBeVisible();
  await target.screenshot({ path: 'tests/agent/.out/voci/prefs-custom.png' });
  // Il salvataggio (debounce) porta il nome scritto a mano nelle impostazioni.
  await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts.modelVoice),
    { timeout: 10_000 }).toBe('la-mia-voce');
  // Testo dell'etichetta del modello.
  expect(await page.locator('#ttsModelVoiceModel').textContent()).toContain('microsoft/mai-voice-2');
});
