// Verifica temporanea LIVE: tre chiamate brevi al router vero.
import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const envPath = join(homedir(), 'Desktop', 'Filo', 'filo-security', '.env');
const KEY = (/JUDGE_OPENROUTER_KEY=(\S+)/.exec(readFileSync(envPath, 'utf8')) || [])[1] || '';

const REG = {
  mai: { label: 'MAI Voice 2', provider: 'openrouter', model: 'microsoft/mai-voice-2', inputs: ['text'], outputs: ['audio'] },
  maiflash: { label: 'MAI Voice 2 flash', provider: 'openrouter', model: 'microsoft/mai-voice-2-flash', inputs: ['text'], outputs: ['audio'] },
  aura: { label: 'Aura 2', provider: 'openrouter', model: 'deepgram/aura-2', inputs: ['text'], outputs: ['audio'] },
};

async function setTts(app, nick, ttsPrefs = {}) {
  await app.evaluate(async (_e, { nick, ttsPrefs, REG, KEY }) => {
    const base = globalThis.SN_TEST_MODELS;
    const models = { ...base.models, tts: nick };
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: KEY },
      modelRegistry: { ...base.registry, ...REG },
      models,
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: '', ...ttsPrefs },
    });
  }, { nick, ttsPrefs, REG, KEY });
}

test('live: mai-voice-2 it, aura-2 en, mai-voice-2-flash en', async ({ app, openTab }) => {
  test.skip(!KEY, 'chiave assente');
  test.setTimeout(120000);
  // spia sul provider vero: registra la voce mandata, poi chiama l'originale
  await app.evaluate(() => {
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      synthesizeSpeech: async (args) => {
        globalThis.__ttsCalls.push({ model: args.model, voice: args.voice || '' });
        try { return await orig.synthesizeSpeech(args); }
        catch (e) { globalThis.__ttsCalls.push({ err: String(e && e.message).slice(0, 300) }); throw e; }
      },
    };
  });
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#ttsModelVoice');
  const synth = (text, lang) => page.evaluate(({ text, lang }) => chrome.runtime.sendMessage({ type: 'tts_synth', text, lang }), { text, lang });

  await setTts(app, 'mai');
  let r = await synth('Ciao, prova.', 'it');
  let c = await app.evaluate(() => globalThis.__ttsCalls);
  console.log('[live] mai it →', JSON.stringify({ ok: r.ok, err: r.error, code: r.errorCode, mime: r.mimeType, bytes: (r.audioBase64 || '').length }), JSON.stringify(c));
  expect(r.ok).toBe(true);

  await app.evaluate(() => { globalThis.__ttsCalls = []; });
  await setTts(app, 'aura');
  r = await synth('Hello, test.', 'en');
  c = await app.evaluate(() => globalThis.__ttsCalls);
  console.log('[live] aura en →', JSON.stringify({ ok: r.ok, err: r.error, code: r.errorCode, mime: r.mimeType, bytes: (r.audioBase64 || '').length }), JSON.stringify(c));
  expect(r.ok).toBe(true);

  await app.evaluate(() => { globalThis.__ttsCalls = []; });
  await setTts(app, 'maiflash');
  r = await synth('Hello, test.', 'en');
  c = await app.evaluate(() => globalThis.__ttsCalls);
  console.log('[live] maiflash en →', JSON.stringify({ ok: r.ok, err: r.error, code: r.errorCode, mime: r.mimeType, bytes: (r.audioBase64 || '').length }), JSON.stringify(c));
  expect(r.ok).toBe(true);
});
