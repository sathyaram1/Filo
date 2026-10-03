// Voce e dettatura con un modello servito solo dal produttore escluso (#713): il router
// ignora la lista di esclusione sugli endpoint audio, quindi Filo legge prima chi serve il
// modello e, se nessuno è ammesso, non chiama e dice perché. Router finto nel main (fetch).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

async function preparaRouter(app, { tts, stt }) {
  await app.evaluate(async (_e, { tts, stt }) => {
    const A = globalThis.SN_CONST.ACTIONS;
    const T = globalThis.SN_TEST_MODELS;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: {
        ...T.registry,
        'voce-openai': { label: 'Voce OpenAI', provider: 'openrouter', model: 'openai/gpt-4o-mini-tts', inputs: ['text'], outputs: ['audio'] },
        'voce-openai-hd': { label: 'Voce OpenAI HD', provider: 'openrouter', model: 'openai/tts-1-hd', inputs: ['text'], outputs: ['audio'] },
        'ascolto-openai': { label: 'Dettatura OpenAI', provider: 'openrouter', model: 'openai/gpt-4o-transcribe', inputs: ['audio'], outputs: ['text'] },
      },
      models: { ...T.models, [A.TTS]: tts, [A.TRANSCRIBE_AUDIO]: stt },
    });
    const OR = globalThis.SN_PROVIDER_OPENROUTER;
    OR.forgetModelHosts();
    const HOSTS = {
      'openai/gpt-4o-mini-tts': [{ provider_name: 'OpenAI', tag: 'openai' }],
      'openai/gpt-4o-transcribe': [{ provider_name: 'OpenAI', tag: 'openai' }],
      'openai/tts-1-hd': [{ provider_name: 'OpenAI', tag: 'openai' }],
      'hexgrad/kokoro-82m': [{ provider_name: 'DeepInfra', tag: 'deepinfra/fp16' }, { provider_name: 'Together', tag: 'together' }],
    };
    globalThis.__audioCalls = [];
    globalThis.__hostLookups = [];
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith(`${OR.MODELS_ENDPOINT}/`) && url.endsWith('/endpoints')) {
        const model = decodeURIComponent(url.slice(OR.MODELS_ENDPOINT.length + 1, -'/endpoints'.length));
        globalThis.__hostLookups.push(model);
        return HOSTS[model] ? json({ data: { id: model, endpoints: HOSTS[model] } }) : json({ error: 'not found' }, 404);
      }
      if (url === OR.SPEECH_ENDPOINT) {
        globalThis.__audioCalls.push({ url, model: JSON.parse(init.body).model });
        return new Response(Buffer.alloc(4800), { status: 200, headers: { 'content-type': 'audio/pcm;rate=24000', 'x-generation-id': 'gen-x' } });
      }
      if (url === OR.TRANSCRIPTIONS_ENDPOINT) {
        globalThis.__audioCalls.push({ url, model: JSON.parse(init.body).model });
        return json({ text: 'ciao', usage: { seconds: 1, cost: 0.00001 } });
      }
      if (url.startsWith(OR.GENERATION_ENDPOINT)) return json({ error: 'not yet' }, 404);
      return globalThis.__fetchVero(input, init);
    };
  }, { tts, stt });
}

test('Voce e dettatura: un modello servito solo da un fornitore escluso non parte, e Filo dice perché', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, { tts: 'voce-openai', stt: 'ascolto-openai' });

  const page = await newtabPage(app);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await page.waitForFunction(() => typeof window.SN_TTS?.startDictation === 'function', null, { timeout: 8_000 });

  // Lettura: nessuna richiesta audio, e la risposta porta il motivo da mostrare.
  const voce = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao, prova.', lang: 'it-IT' }));
  expect(voce.ok).toBe(false);
  expect(voce.errorCode).toBe('NO_ALLOWED_HOST');
  expect(voce.error).toContain('openai/gpt-4o-mini-tts');
  expect(voce.error).toContain('OpenAI');
  expect(voce.error).toContain('Non ho mandato niente');

  // Dettatura dal tasto destro: si parla, e il riquadro si chiude col motivo invece di trascrivere.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__fakeMic = { gain };
      return dest.stream;
    };
  });
  await page.locator('#input').focus();
  await page.locator('#input').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_TTS.startDictation());
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__fakeMic.gain.gain.value = 0; });

  const avviso = page.locator('.sn-toast', { hasText: 'Non ho mandato niente' });
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toContainText('openai/gpt-4o-transcribe');
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => document.querySelector('#input').value)).toBe('');
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/voce-dettatura-host-esclusi.png` });

  // La prova dalle Opzioni passa dallo stesso controllo.
  const prova = await page.evaluate(() => chrome.runtime.sendMessage({
    type: 'test_provider', provider: 'openrouter', apiKey: 'k-test', model: 'openai/gpt-4o-mini-tts', nickname: 'voce-openai',
  }));
  expect(prova.ok).toBe(false);
  expect(prova.error).toContain('Non ho mandato niente');

  const fatto = await app.evaluate(() => ({ audio: globalThis.__audioCalls, lookups: globalThis.__hostLookups }));
  expect(fatto.audio, 'nessuna richiesta audio è arrivata al router').toEqual([]);
  expect(fatto.lookups).toContain('openai/gpt-4o-mini-tts');
  expect(fatto.lookups).toContain('openai/gpt-4o-transcribe');

  // Controprova: con un modello che ha un host ammesso la lettura parte davvero.
  await preparaRouter(app, { tts: 'kokoro', stt: 'ascolto-openai' });
  const ok = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao di nuovo.', lang: 'it-IT' }));
  expect(ok.ok).toBe(true);
  expect(ok.audioBase64.length).toBeGreaterThan(0);
  const dopo = await app.evaluate(() => globalThis.__audioCalls);
  expect(dopo.map((c) => c.model)).toEqual(['hexgrad/kokoro-82m']);

  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});

test('Voce: un altro modello escluso, scelto dopo il primo rifiuto, ha il suo avviso; lo stesso motivo no', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  const leggi = () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao.', lang: 'it-IT' }));

  await preparaRouter(app, { tts: 'voce-openai', stt: 'ascolto-openai' });
  const primo = await leggi();
  expect(primo.errorCode).toBe('NO_ALLOWED_HOST');
  expect(primo.firstFallback).toBe(true);
  expect((await leggi()).firstFallback, 'stesso motivo: niente avviso ripetuto').toBe(false);

  await preparaRouter(app, { tts: 'voce-openai-hd', stt: 'ascolto-openai' });
  const altro = await leggi();
  expect(altro.errorCode).toBe('NO_ALLOWED_HOST');
  expect(altro.error).toContain('openai/tts-1-hd');
  expect(altro.firstFallback, 'il motivo del nuovo modello arriva all\'utente').toBe(true);
  expect(await app.evaluate(() => globalThis.__audioCalls)).toEqual([]);

  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});
