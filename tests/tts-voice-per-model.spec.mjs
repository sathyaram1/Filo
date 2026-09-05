// Lettura ad alta voce: le voci seguono il MODELLO. Il modello di lettura può
// cambiare (dai Modelli predefiniti, copiando un id dal router) e ogni
// modello ha i suoi nomi di voce: prima del fix a MAI-Voice (Azure) arrivava
// `if_sara` (una voce di Kokoro) → 400 → lettura con la voce del browser,
// senza spiegazioni.
//
// ASSERISCE IL SUCCESSO: col modello cambiato l'audio arriva e la voce
// mandata è del catalogo di quel modello, nella lingua del testo; una voce
// del modello vecchio rimasta nelle Preferenze si ignora; un modello ignoto
// impara le voci dall'errore del router e la seconda lettura parte già con
// quella giusta; un modello che pretende una voce senza elencarle produce un
// avviso che dice dove scriverla.

import { test, expect } from './fixtures/electron.mjs';

const PCM = () => ({
  audioBase64: Buffer.alloc(4800).toString('base64'),
  mimeType: 'audio/pcm;rate=24000;channels=1',
  generationId: null,
});

test('Lettura: cambiato il modello, la voce è del suo catalogo (e una voce del modello vecchio si ignora)', async ({ app, openTab }) => {
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
      // Voce di Kokoro rimasta salvata da prima.
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: 'im_nicola' },
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    P.synthesizeSpeech = async ({ model, text, voice }) => {
      globalThis.__ttsCalls.push({ model, text, voice });
      // Come fa Azure: una voce che non è sua è un 400 secco.
      if (!/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(voice || '')) {
        const e = new Error('OpenRouter 400: {"error":{"message":"Provider returned 400","code":400}}');
        e.status = 400; throw e;
      }
      return { audioBase64: Buffer.alloc(4800).toString('base64'), mimeType: 'audio/pcm;rate=24000;channels=1', generationId: null };
    };
    P.lookupServedBy = async () => ({ servedBy: 'Azure', costUsd: 0.0001 });
  });

  const page = await openTab('filo://newtab/');
  const synth = (text, lang) => page.evaluate(({ text, lang }) =>
    chrome.runtime.sendMessage({ type: 'tts_synth', text, lang }), { text, lang });

  const it = await synth('Ciao, questa è una prova con MAI.', 'it-IT');
  expect(it.ok).toBe(true);
  expect(it.model).toBe('microsoft/mai-voice-2');
  let calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls[0].voice).toBe('it-IT-ElsaNeural');

  const en = await synth('Hello, a test with MAI.', 'en-US');
  expect(en.ok).toBe(true);
  calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls[1].voice).toBe('en-US-AvaNeural');

  // Una voce del catalogo GIUSTO vince sulla lingua.
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ tts: { modelVoice: 'en-GB-SoniaNeural' } }); });
  const fissa = await synth('Ancora una prova, in italiano.', 'it-IT');
  expect(fissa.ok).toBe(true);
  calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls[2].voice).toBe('en-GB-SoniaNeural');

  // Le Preferenze chiedono le voci del modello in uso: sono quelle di MAI.
  const info = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_voices' }));
  expect(info.ok).toBe(true);
  expect(info.model).toBe('microsoft/mai-voice-2');
  expect(info.catalog).toBe('azure');
  expect(info.groups[0].lang).toBe('it');
  expect(info.groups[0].voices.map((v) => v.id)).toContain('it-IT-ElsaNeural');
});

test('Lettura: un modello ignoto impara le voci dall\'errore del router, o dice che serve un nome', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    const nick = C.parseModelRefs(T.models[C.ACTIONS.TTS])[0];
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...T.registry, [nick]: { provider: 'openrouter', model: 'acme/voce-ignota' } },
      models: { ...T.models },
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: '' },
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    globalThis.__ttsMode = 'lista';
    P.synthesizeSpeech = async ({ model, voice }) => {
      globalThis.__ttsCalls.push({ model, voice });
      if (globalThis.__ttsMode === 'muto') {
        const e = new Error('OpenRouter 400: {"error":{"message":"An explicit voice is required for this TTS provider.","code":400}}');
        e.status = 400; throw e;
      }
      if (!['acme-luna-it', 'acme-sol-en'].includes(voice || '')) {
        const e = new Error(`OpenRouter 400: {"error":{"message":"Unknown voice \\"${voice}\\". Supported voices: acme-sol-en, acme-luna-it.","code":400}}`);
        e.status = 400; throw e;
      }
      return { audioBase64: Buffer.alloc(4800).toString('base64'), mimeType: 'audio/pcm;rate=24000;channels=1', generationId: null };
    };
    P.lookupServedBy = async () => ({ servedBy: 'Acme', costUsd: 0 });
  });

  const page = await openTab('filo://newtab/');
  const synth = (text, lang) => page.evaluate(({ text, lang }) =>
    chrome.runtime.sendMessage({ type: 'tts_synth', text, lang }), { text, lang });

  // Prima lettura: senza voce → il router elenca le voci → si riprova con quella italiana.
  const prima = await synth('Prima lettura.', 'it');
  expect(prima.ok).toBe(true);
  let calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls.map((c) => c.voice)).toEqual(['', 'acme-luna-it']);

  // Seconda lettura: la lista è imparata, si parte già con la voce giusta.
  const seconda = await synth('Second reading.', 'en');
  expect(seconda.ok).toBe(true);
  calls = await app.evaluate(() => globalThis.__ttsCalls);
  expect(calls.length).toBe(3);
  expect(calls[2].voice).toBe('acme-sol-en');

  // Le Preferenze vedono le voci imparate.
  const info = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_voices' }));
  expect(info.ok).toBe(true);
  expect(info.groups.flatMap((g) => g.voices.map((v) => v.id)).sort()).toEqual(['acme-luna-it', 'acme-sol-en']);

  // Un modello che pretende una voce senza dire quali: l'avviso dice dove scriverla.
  await app.evaluate(async () => {
    globalThis.__ttsMode = 'muto';
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    const nick = C.parseModelRefs(T.models[C.ACTIONS.TTS])[0];
    await globalThis.SN_STORAGE.updateSettings({
      modelRegistry: { ...T.registry, [nick]: { provider: 'openrouter', model: 'acme/voce-muta' } },
    });
  });
  const muta = await synth('Terza lettura.', 'it');
  expect(muta.ok).toBe(false);
  expect(muta.errorCode).toBe('TTS_VOICE_REQUIRED');
  expect(muta.error).toContain('acme/voce-muta');
  expect(muta.error).toContain('Preferenze');

  // Un nome scritto a mano che il modello rifiuta: è un errore di battitura,
  // e l'avviso lo dice (non «voce non disponibile ora»).
  await app.evaluate(async () => {
    globalThis.__ttsMode = 'rifiuta';
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    const nick = C.parseModelRefs(T.models[C.ACTIONS.TTS])[0];
    await globalThis.SN_STORAGE.updateSettings({
      modelRegistry: { ...T.registry, [nick]: { provider: 'openrouter', model: 'microsoft/mai-voice-2' } },
      tts: { modelVoice: 'it-IT-ElsaNeurall' },
    });
    globalThis.SN_PROVIDER_OPENROUTER.synthesizeSpeech = async () => {
      const e = new Error('OpenRouter 400: {"error":{"message":"Provider returned 400","code":400}}');
      e.status = 400; throw e;
    };
  });
  const battuta = await synth('Quarta lettura.', 'it');
  expect(battuta.ok).toBe(false);
  expect(battuta.errorCode).toBe('TTS_VOICE_UNKNOWN');
  expect(battuta.error).toContain('it-IT-ElsaNeurall');
  expect(battuta.error).toContain('Preferenze');
});
