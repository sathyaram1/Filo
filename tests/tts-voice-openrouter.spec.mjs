// Lettura ad alta voce senza Google: passa dal router, con una voce a pesi
// aperti scelta in base alla lingua del testo, e col riscontro su chi ha servito.
//
// ASSERISCE IL SUCCESSO: la sintesi torna audio dal router col modello di
// lettura configurato; un testo italiano prende una voce italiana, uno inglese
// una voce inglese; una voce fissata in Preferenze vince sulla lingua; la
// velocità delle Preferenze arriva al modello; la lista di esclusione dei
// fornitori viaggia con la richiesta; il costo, che il router dice solo dopo,
// finisce comunque nei costi. Precondizione (prima del fix): la sintesi era
// solo Google → { ok:false } e ripiego sulla voce del browser → rosso.

import { test, expect } from './fixtures/electron.mjs';

test('Lettura: voce a pesi aperti via il router, nella lingua del testo, con chi ha servito', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { ...C.DEFAULT_MODELS },
      tts: { voice: '', rate: 1.3, pitch: 1, modelVoice: '' },
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    P.synthesizeSpeech = async ({ model, text, voice, speed, providerRouting }) => {
      globalThis.__ttsCalls.push({ model, text, voice, speed, ignore: (providerRouting && providerRouting.ignore) || [] });
      return {
        audioBase64: Buffer.alloc(4800).toString('base64'),
        mimeType: 'audio/pcm;rate=24000;channels=1',
        generationId: 'gen-tts-test',
      };
    };
    P.lookupServedBy = async () => ({ servedBy: 'DeepInfra', costUsd: 0.0002 });
  });

  const page = await openTab('filo://newtab/');
  const synth = (text, lang) => page.evaluate(({ text, lang }) =>
    chrome.runtime.sendMessage({ type: 'tts_synth', text, lang }), { text, lang });

  // Testo italiano → audio dal router, voce italiana.
  const it = await synth('Ciao, questa è una prova.', 'it-IT');
  expect(it.ok).toBe(true);
  expect(it.provider).toBe('openrouter');
  expect(it.model).toBe('hexgrad/kokoro-82m');
  expect(it.mimeType).toMatch(/rate=24000/);
  expect(it.audioBase64.length).toBeGreaterThan(0);

  // Testo inglese → voce inglese. Testo diverso, così non è la cache a rispondere.
  const en = await synth('Hello, this is a test.', 'en-US');
  expect(en.ok).toBe(true);

  let calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls.length).toBe(2);
  expect(calls[0].voice).toBe('if_sara');
  expect(calls[1].voice).toMatch(/^[ab][fm]_/);
  // Velocità delle Preferenze e lista di esclusione con ogni richiesta.
  expect(calls[0].speed).toBeCloseTo(1.3, 5);
  expect(calls[0].ignore.length).toBeGreaterThan(0);
  expect(calls[0].ignore.some((x) => /google/i.test(x))).toBe(true);

  // Una voce fissata in Preferenze vince sulla lingua del testo.
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ tts: { modelVoice: 'im_nicola' } });
  });
  const fissa = await synth('Hello again, another test.', 'en-US');
  expect(fissa.ok).toBe(true);
  calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls[2].voice).toBe('im_nicola');

  // Il costo arriva dopo (riscontro asincrono) e finisce nei costi del mese.
  await expect.poll(async () => app.evaluate(async () => (await globalThis.SN_COSTS.getMonthly()).totalEur),
    { timeout: 20_000 }).toBeGreaterThan(0);
});

test('Lettura: il modello di lettura non è più Google, e senza chiave si ripiega con grazia', async ({ app, openTab }) => {
  const info = await app.evaluate(() => {
    const C = globalThis.SN_CONST;
    const nick = C.parseModelRefs(C.DEFAULT_MODELS[C.ACTIONS.TTS])[0];
    const e = C.DEFAULT_MODEL_REGISTRY[nick];
    return { provider: e.provider, model: e.model, open: C.isOpenWeightsEntry(e), hasGeminiProvider: !!globalThis.SN_PROVIDER_GEMINI };
  });
  expect(info.provider).toBe('openrouter');
  expect(info.model).not.toMatch(/gemini/i);
  expect(info.open).toBe(true);
  expect(info.hasGeminiProvider).toBe(false);

  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: '' },
      modelRegistry: { ...C.DEFAULT_MODEL_REGISTRY },
      models: { ...C.DEFAULT_MODELS },
    });
  });
  const page = await openTab('filo://newtab/');
  const res = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'ciao', lang: 'it' }));
  expect(res.ok).toBe(false);
});
