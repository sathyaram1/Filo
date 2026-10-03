// Verifica #713 giro 1, rilievo 1: dopo un primo rifiuto, un secondo modello vocale servito solo
// da un fornitore escluso viene rifiutato in silenzio (la risposta non chiede più di mostrare il motivo).
import { test, expect } from '../../fixtures/electron.mjs';

async function prepara(app, tts) {
  await app.evaluate(async (_e, tts) => {
    const A = globalThis.SN_CONST.ACTIONS;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: {
        ...T.registry,
        'voce-a': { label: 'Voce A', provider: 'openrouter', model: 'openai/gpt-4o-mini-tts', inputs: ['text'], outputs: ['audio'] },
        'voce-b': { label: 'Voce B', provider: 'openrouter', model: 'openai/tts-1-hd', inputs: ['text'], outputs: ['audio'] },
      },
      models: { ...T.models, [A.TTS]: tts },
    });
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__audioCalls = [];
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith(`${OR.MODELS_ENDPOINT}/`) && url.endsWith('/endpoints')) {
        return json({ data: { endpoints: [{ provider_name: 'OpenAI', tag: 'openai' }] } });
      }
      if (url === OR.SPEECH_ENDPOINT) {
        globalThis.__audioCalls.push(JSON.parse(init.body).model);
        return new Response(Buffer.alloc(4800), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000' } });
      }
      return globalThis.__fetchVero(input, init);
    };
  }, tts);
}

test('un secondo modello vocale escluso, scelto dopo il primo rifiuto, viene spiegato anche lui', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  let page = null;
  for (let i = 0; i < 100 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await prepara(app, 'voce-a');
  const primo = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao.', lang: 'it-IT' }));
  expect(primo.errorCode).toBe('NO_ALLOWED_HOST');
  expect(primo.firstFallback).toBe(true);

  await prepara(app, 'voce-b');
  const secondo = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao.', lang: 'it-IT' }));
  expect(secondo.errorCode).toBe('NO_ALLOWED_HOST');
  expect(secondo.error).toContain('openai/tts-1-hd');
  expect(secondo.firstFallback, 'il motivo del nuovo modello deve arrivare all\'utente').toBe(true);
  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});
