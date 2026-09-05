// Verifica temporanea: la voce della lettura segue il modello di lettura.
import { test, expect } from './fixtures/electron.mjs';

const REG = {
  mai: { label: 'MAI Voice 2', provider: 'openrouter', model: 'microsoft/mai-voice-2', inputs: ['text'], outputs: ['audio'] },
  maiflash: { label: 'MAI Voice 2 flash', provider: 'openrouter', model: 'microsoft/mai-voice-2-flash', inputs: ['text'], outputs: ['audio'] },
  fish: { label: 'Fish', provider: 'openrouter', model: 'fish-audio/s2-pro', inputs: ['text'], outputs: ['audio'] },
  aura: { label: 'Aura 2', provider: 'openrouter', model: 'deepgram/aura-2', inputs: ['text'], outputs: ['audio'] },
  boh: { label: 'Inventato', provider: 'openrouter', model: 'acme/voce-inventata', inputs: ['text'], outputs: ['audio'] },
  kokoro: { label: 'Kokoro', provider: 'openrouter', model: 'hexgrad/kokoro-82m', inputs: ['text'], outputs: ['audio'], weights: 'open' },
};

async function stubProvider(app, mode) {
  await app.evaluate((_e, mode) => {
    if (!globalThis.__origOR) globalThis.__origOR = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origOR,
      synthesizeSpeech: async ({ model, text, voice, speed }) => {
        globalThis.__ttsCalls.push({ model, text, voice: voice || '', speed });
        if (mode === 'mai-400' && /mai-voice/.test(model)) {
          if (!voice) throw Object.assign(new Error('OpenRouter 400: {"error":{"message":"An explicit voice is required for this TTS provider.","code":400}}'), { status: 400 });
          if (!/^[a-z]{2}-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice)) throw Object.assign(new Error('OpenRouter 400: {"error":{"message":"Provider returned 400","code":400}}'), { status: 400 });
        }
        if (mode === 'aura-list' && /acme|aura/.test(model)) {
          const ok = ['aura-2-thalia-en', 'aura-2-cinzia-it', 'aura-2-apollo-en'];
          if (!ok.includes(voice)) throw Object.assign(new Error(`OpenRouter 400: {"error":{"message":"Unknown voice \\"${voice}\\". Supported voices: ${ok.join(', ')}.","code":400}}`), { status: 400 });
        }
        return { audioBase64: Buffer.alloc(8000).toString('base64'), mimeType: 'audio/L16;rate=8000', generationId: null };
      },
    };
  }, mode);
}

async function setTts(app, nick, ttsPrefs = {}) {
  await app.evaluate(async (_e, { nick, ttsPrefs, REG }) => {
    const base = globalThis.SN_TEST_MODELS;
    const models = { ...base.models };
    if (nick) models.tts = nick; else delete models.tts;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...base.registry, ...REG },
      models,
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: '', ...ttsPrefs },
    });
  }, { nick, ttsPrefs, REG });
}

// Il messaggio parte da una pagina interna (ha chrome.runtime nel main world).
async function bridge(openTab) {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#ttsModelVoice');
  return page;
}
const synth = (page, text, lang, voice) => page.evaluate(
  ({ text, lang, voice }) => chrome.runtime.sendMessage({ type: 'tts_synth', text, lang, ...(voice !== undefined ? { voice } : {}) }),
  { text, lang, voice },
);
const calls = (app) => app.evaluate(() => globalThis.__ttsCalls);
const resetCalls = (app) => app.evaluate(() => { globalThis.__ttsCalls = []; });

const PAGE = (lang, text) => `<html lang="${lang}"><body><p id="target">${text}</p><p>altro</p></body></html>`;
async function leggi(page) {
  await page.evaluate(() => {
    const el = document.getElementById('target');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('#target').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  await page.locator('.sn-menu-item', { hasText: 'Leggi' }).first().click();
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.sn-toasts > *')].map((e) => e.textContent.trim()).filter(Boolean));
async function waitToast(page, ms = 8000) {
  const t0 = Date.now(); let last = [];
  while (Date.now() - t0 < ms) { last = await toasts(page); if (last.length) return last; await page.waitForTimeout(200); }
  return last;
}
async function stopReading(page) {
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.locator('body').click({ button: 'right', position: { x: 5, y: 5 } });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  const stop = page.locator('.sn-menu-item', { hasText: 'Interrompi lettura' });
  if (await stop.count()) await stop.first().click(); else await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test.describe('voce per modello (main)', () => {
  test('ogni modello riceve una voce sua, in base alla lingua', async ({ app, openTab }) => {
    await stubProvider(app, 'ok');
    const page = await bridge(openTab);
    const cases = [
      ['mai', 'it', /^it-IT-.*Neural$/],
      ['mai', 'en', /^en-(US|GB)-.*Neural$/],
      ['maiflash', 'it', /^it-IT-.*Neural$/],
      ['aura', 'it', /^aura-2-.*-it$/],
      ['aura', 'en', /^aura-2-.*-en$/],
      ['kokoro', 'it', /^i[fm]_/],
      ['kokoro', 'en', /^[ab][fm]_/],
      ['fish', 'it', /^$/],
      ['boh', 'it', /^$/],
    ];
    for (const [nick, lang, rx] of cases) {
      await setTts(app, nick);
      await resetCalls(app);
      const text = `Testo ${nick} ${lang} ${Date.now()}`;
      const res = await synth(page, text, lang);
      const c = await calls(app);
      expect(res.ok, `${nick}/${lang}: ${JSON.stringify(res)}`).toBe(true);
      expect(c.length, `${nick}/${lang} chiamate`).toBe(1);
      expect(c[0].model).toBe(REG[nick].model);
      expect(c[0].voice, `${nick}/${lang} voce=${c[0].voice}`).toMatch(rx);
    }
  });

  test('lettura vera dal menu: lingua della pagina', async ({ app, openTab, testServer }) => {
    await stubProvider(app, 'ok');
    await setTts(app, 'mai');
    const en = await testServer.openReady(openTab, PAGE('en', 'Hello there, this is a page in English to be read aloud.'));
    await resetCalls(app);
    await leggi(en);
    await en.waitForTimeout(1500);
    let c = await calls(app);
    console.log('[verifica] lettura en →', JSON.stringify(c.map((x) => [x.voice, x.text.slice(0, 20)])), 'toast:', JSON.stringify(await toasts(en)));
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.voice).toMatch(/^en-/);

    await stopReading(en);
    await setTts(app, 'aura');
    const it = en;
    await it.goto(testServer.html(PAGE('it', 'Buongiorno, questa è una pagina in italiano da leggere ad alta voce.')));
    await it.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await resetCalls(app);
    await leggi(it);
    await it.waitForTimeout(1500);
    c = await calls(app);
    console.log('[verifica] lettura it/aura →', JSON.stringify(c.map((x) => [x.voice, x.text.slice(0, 20)])));
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.voice).toMatch(/^aura-2-.*-it$/);

    await stopReading(it);
    // pagina senza lang
    await setTts(app, 'mai');
    const nolang = en;
    await nolang.goto(testServer.html('<html><body><p id="target">Senza lingua dichiarata, un testo qualunque.</p></body></html>'));
    await nolang.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await resetCalls(app);
    await leggi(nolang);
    await nolang.waitForTimeout(1500);
    c = await calls(app);
    console.log('[verifica] lettura senza lang →', JSON.stringify(c.map((x) => x.voice)));
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x.voice).toMatch(/Neural$/);
  });

  test('testi limite', async ({ app, openTab }) => {
    await stubProvider(app, 'ok');
    await setTts(app, 'mai');
    const page = await bridge(openTab);
    await resetCalls(app);
    let res = await synth(page, 'x'.repeat(10000), 'en');
    let c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toMatch(/^en-/);

    await resetCalls(app);
    res = await synth(page, '   ', 'it');
    c = await calls(app);
    console.log('[verifica] solo spazi →', JSON.stringify(res).slice(0, 120), c.map((x) => x.voice));

    await resetCalls(app);
    res = await synth(page, '<script>alert(1)</script> 😀  ', 'ja');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toMatch(/^ja-JP-/);

    await resetCalls(app);
    res = await synth(page, 'lingua ignota', 'xx');
    c = await calls(app);
    expect(res.ok).toBe(true);
    console.log('[verifica] lingua ignota → voce', c[0].voice);
    expect(c[0].voice).toMatch(/^en-/);

    await resetCalls(app);
    res = await synth(page, 'senza lingua', undefined);
    c = await calls(app);
    expect(res.ok).toBe(true);
    console.log('[verifica] senza lang → voce', c[0].voice);
    expect(c[0].voice).toMatch(/Neural$/);
  });

  test('voce salvata da un modello precedente: ignorata col modello nuovo', async ({ app, openTab }) => {
    await stubProvider(app, 'mai-400');
    const page = await bridge(openTab);
    await setTts(app, 'kokoro', { modelVoice: 'im_nicola' });
    await resetCalls(app);
    let res = await synth(page, 'Prova kokoro', 'it');
    let c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toBe('im_nicola');
    await setTts(app, 'mai', { modelVoice: 'im_nicola' });
    await resetCalls(app);
    res = await synth(page, 'Prova mai dopo kokoro', 'it');
    c = await calls(app);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(c.length).toBe(1);
    expect(c[0].voice).toMatch(/^it-IT-.*Neural$/);
    await resetCalls(app);
    res = await synth(page, 'English after kokoro', 'en');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toMatch(/^en-/);
    await setTts(app, 'kokoro', { modelVoice: 'it-IT-DiegoNeural' });
    await resetCalls(app);
    res = await synth(page, 'Kokoro dopo mai', 'it');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toMatch(/^i[fm]_/);
    await setTts(app, 'aura', { modelVoice: 'it-IT-DiegoNeural' });
    await resetCalls(app);
    res = await synth(page, 'Aura dopo mai', 'en');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toMatch(/^aura-2-.*-en$/);
    await setTts(app, 'fish', { modelVoice: 'it-IT-DiegoNeural' });
    await resetCalls(app);
    res = await synth(page, 'Fish dopo mai', 'it');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c[0].voice).toBe('');
  });

  test('voce scritta a mano sbagliata per mai-voice-2: errore spiegato', async ({ app, openTab, testServer }) => {
    await stubProvider(app, 'mai-400');
    const page = await bridge(openTab);
    await setTts(app, 'mai', { modelVoice: 'Elsa' });
    await resetCalls(app);
    const res = await synth(page, 'Voce sbagliata', 'it');
    const c = await calls(app);
    console.log('[verifica] voce sbagliata →', JSON.stringify(res), JSON.stringify(c));
    expect(res.ok).toBe(false);
    expect(c[0].voice).toBe('Elsa');
    expect(res.errorCode).toBe('TTS_VOICE_UNKNOWN');
    expect(res.error).toContain('Elsa');
    expect(res.error).toContain('mai-voice-2');
    expect(res.firstFallback).toBe(true);
    const res2 = await synth(page, 'Voce sbagliata due', 'it');
    expect(res2.ok).toBe(false);
    expect(res2.firstFallback).toBe(false);

    // Lettura vera: cosa vede l'utente (toast)? Nuova app-sessione non c'è:
    // riarmo l'avviso con una sintesi buona.
    await setTts(app, 'mai', { modelVoice: '' });
    await synth(page, 'riarmo', 'it');
    await setTts(app, 'mai', { modelVoice: 'Elsa' });
    const it = await testServer.openReady(openTab, PAGE('it', 'Testo da leggere con la voce sbagliata.'));
    await resetCalls(app);
    await leggi(it);
    const t = await waitToast(it);
    console.log('[verifica] toast voce sbagliata →', JSON.stringify(t), 'calls:', JSON.stringify(await calls(app)));
    expect(t.join(' ')).toMatch(/Elsa/);
    expect(t.join(' ')).toMatch(/Preferenze/);

    await setTts(app, 'mai', { modelVoice: 'it-IT-FabiolaNeural' });
    await resetCalls(app);
    const res3 = await synth(page, 'Voce a mano valida', 'it');
    const c3 = await calls(app);
    expect(res3.ok, JSON.stringify(res3)).toBe(true);
    expect(c3[0].voice).toBe('it-IT-FabiolaNeural');
    await setTts(app, 'mai', { modelVoice: 'it-IT-DiegoNeural' });
    await resetCalls(app);
    const res4 = await synth(page, 'English text with Diego', 'en');
    const c4 = await calls(app);
    expect(res4.ok).toBe(true);
    expect(c4[0].voice).toBe('it-IT-DiegoNeural');
  });

  test('modello sconosciuto: impara le voci dal router e riprova', async ({ app, openTab }) => {
    await stubProvider(app, 'aura-list');
    const page = await bridge(openTab);
    await setTts(app, 'boh');
    await resetCalls(app);
    let res = await synth(page, 'Prova inventato it', 'it');
    let c = await calls(app);
    console.log('[verifica] inventato →', JSON.stringify(res).slice(0, 100), JSON.stringify(c.map((x) => x.voice)));
    expect(res.ok).toBe(true);
    expect(c.map((x) => x.voice)).toEqual(['', 'aura-2-cinzia-it']);
    await resetCalls(app);
    res = await synth(page, 'Prova inventato en', 'en');
    c = await calls(app);
    expect(res.ok).toBe(true);
    expect(c.map((x) => x.voice)).toEqual(['aura-2-thalia-en']);
    // la tendina ora conosce le voci imparate?
    const info = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_voices' }));
    console.log('[verifica] tts_voices dopo apprendimento →', JSON.stringify(info));
    expect(info.groups.length).toBeGreaterThan(0);
    await setTts(app, 'boh', { modelVoice: 'pippo' });
    await resetCalls(app);
    res = await synth(page, 'Prova inventato pippo', 'it');
    c = await calls(app);
    console.log('[verifica] inventato+pippo →', JSON.stringify(res).slice(0, 200), JSON.stringify(c.map((x) => x.voice)));
    await setTts(app, 'aura', { modelVoice: 'aura-2-cesare-it' });
    await resetCalls(app);
    res = await synth(page, 'Aura cesare', 'it');
    c = await calls(app);
    console.log('[verifica] aura cesare →', JSON.stringify(res).slice(0, 200), JSON.stringify(c.map((x) => x.voice)));
    expect(res.ok).toBe(true);
  });

  test('nessun modello di lettura: ripiego spiegato', async ({ app, openTab, testServer }) => {
    await stubProvider(app, 'ok');
    const page = await bridge(openTab);
    await setTts(app, '');
    await resetCalls(app);
    const res = await synth(page, 'Senza modello', 'it');
    console.log('[verifica] senza modello →', JSON.stringify(res));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NO_MODEL_FOR_ACTION');
    expect((await calls(app)).length).toBe(0);
    await setTts(app, 'fantasma');
    const res2 = await synth(page, 'Modello fantasma', 'it');
    console.log('[verifica] modello fantasma →', JSON.stringify(res2));
    expect(res2.ok).toBe(false);
    expect(res2.errorCode).toBe('NO_MODEL_FOR_ACTION');
    // toast su lettura vera (l'avviso è già stato consumato dalla prima chiamata: riarmo)
    await setTts(app, 'mai');
    await synth(page, 'riarmo', 'it');
    await setTts(app, '');
    const it = await testServer.openReady(openTab, PAGE('it', 'Testo senza modello.'));
    await leggi(it);
    console.log('[verifica] toast senza modello →', JSON.stringify(await waitToast(it)));
  });
});
