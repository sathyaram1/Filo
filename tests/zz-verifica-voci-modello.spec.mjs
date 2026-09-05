// VERIFICA TEMPORANEA — le voci della lettura seguono il modello impostato.
import { test, expect } from './fixtures/electron.mjs';

async function installFakeRouter(app) {
  await app.evaluate(() => {
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__vCalls = [];
    globalThis.__vMode = {};
    P.synthesizeSpeech = async ({ model, text, voice, speed }) => {
      globalThis.__vCalls.push({ model, text, voice: voice == null ? null : voice, speed });
      const mode = globalThis.__vMode[model];
      if (mode && mode.accept && !mode.accept.includes(voice)) throw new Error(mode.msg);
      if (mode && mode.requireVoice && !voice) throw new Error('Provider returned 400: An explicit voice is required for this TTS provider.');
      return { audioBase64: Buffer.alloc(8000 * 2).toString('base64'), mimeType: 'audio/L16;rate=8000', generationId: '' };
    };
    P.lookupServedBy = async () => null;
  });
}

async function setModel(app, modelId, modelVoice) {
  await app.evaluate(async (_e, { modelId, modelVoice }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: {
        ...globalThis.SN_TEST_MODELS.registry,
        lettura: { label: 'Lettura', provider: 'openrouter', model: modelId, inputs: ['text'], outputs: ['audio'] },
      },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.TTS]: 'lettura' },
      tts: { modelVoice: modelVoice || '', rate: 1, pitch: 1, voice: '' },
    });
  }, { modelId, modelVoice });
}

async function synth(page, text, lang) {
  return page.evaluate(({ text, lang }) => chrome.runtime.sendMessage({ type: 'tts_synth', text, lang }), { text, lang });
}
async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8000 });
  return win;
}
async function calls(app) { return app.evaluate(() => globalThis.__vCalls); }
async function lastCall(app) { const c = await calls(app); return c[c.length - 1]; }

let n = 0;
const uniq = (s) => `${s} (${++n})`;

test('main: la voce mandata segue il modello e la lingua', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await installFakeRouter(app);
  const page = await openTab('filo://preferences/preferences.html');

  const cases = [
    ['microsoft/mai-voice-2', '', 'it', 'it-IT-ElsaNeural'],
    ['microsoft/mai-voice-2', '', 'en', 'en-US-AvaNeural'],
    ['microsoft/mai-voice-2', '', 'en-GB', 'en-US-AvaNeural'],
    ['microsoft/mai-voice-2', '', 'fr-FR', 'fr-FR-DeniseNeural'],
    ['microsoft/mai-voice-2', '', 'sw', 'en-US-AvaNeural'],
    ['microsoft/mai-voice-2', '', '', null], // lingua non dichiarata → locale app
    ['microsoft/mai-voice-2-flash', '', 'it', 'it-IT-ElsaNeural'],
    ['microsoft/mai-voice-2-flash', '', 'en', 'en-US-AvaNeural'],
    ['deepgram/aura-2', '', 'it', 'aura-2-cinzia-it'],
    ['deepgram/aura-2', '', 'en', 'aura-2-thalia-en'],
    ['deepgram/aura-2', '', 'de', 'aura-2-aurelia-de'],
    ['fish-audio/s2-pro', '', 'it', ''],
    ['fish-audio/s2-pro', '', 'en', ''],
    ['hexgrad/kokoro-82m', '', 'it', 'if_sara'],
    ['hexgrad/kokoro-82m', '', 'en', 'af_heart'],
    ['deepgram/flux-tts', '', 'it', 'flux-alexis-en'],
    // voce salvata da un modello precedente: ignorata
    ['microsoft/mai-voice-2', 'if_sara', 'it', 'it-IT-ElsaNeural'],
    ['microsoft/mai-voice-2', 'aura-2-cinzia-it', 'en', 'en-US-AvaNeural'],
    ['deepgram/aura-2', 'it-IT-ElsaNeural', 'it', 'aura-2-cinzia-it'],
    ['hexgrad/kokoro-82m', 'it-IT-ElsaNeural', 'it', 'if_sara'],
    ['fish-audio/s2-pro', 'it-IT-ElsaNeural', 'it', ''],
    // voce scelta del modello giusto: rispettata anche se la lingua è un'altra
    ['microsoft/mai-voice-2', 'it-IT-DiegoNeural', 'en', 'it-IT-DiegoNeural'],
    ['deepgram/aura-2', 'aura-2-apollo-en', 'it', 'aura-2-apollo-en'],
    // nome scritto a mano che nessun catalogo conosce: passa tale e quale
    ['microsoft/mai-voice-2', 'it-IT-FabiolaNeural', 'it', 'it-IT-FabiolaNeural'],
    ['acme/tts-x', 'my-voice', 'it', 'my-voice'],
    ['acme/tts-x', '', 'it', ''],
    // maiuscole / spazi nel nome del modello o della voce
    ['Microsoft/MAI-Voice-2', '', 'it', 'it-IT-ElsaNeural'],
    ['microsoft/mai-voice-2', '  it-IT-DiegoNeural  ', 'it', 'it-IT-DiegoNeural'],
    ['microsoft/mai-voice-2', '', 'IT-it', 'it-IT-ElsaNeural'],
  ];
  const errors = [];
  for (const [model, chosen, lang, want] of cases) {
    await setModel(app, model, chosen);
    const res = await synth(page, uniq(`Testo per ${model} ${lang}`), lang);
    const c = await lastCall(app);
    const got = c && c.voice;
    if (!res || !res.ok) errors.push(`${model} chosen=${JSON.stringify(chosen)} lang=${lang}: risposta ${JSON.stringify(res)}`);
    if (want === null) {
      if (!got || !/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(got)) errors.push(`${model} lang vuota: voce ${JSON.stringify(got)}`);
    } else if (want === '') {
      if (got) errors.push(`${model} chosen=${JSON.stringify(chosen)} lang=${lang}: attesa NESSUNA voce, mandata ${JSON.stringify(got)}`);
    } else if (got !== want) {
      errors.push(`${model} chosen=${JSON.stringify(chosen)} lang=${lang}: attesa ${want}, mandata ${JSON.stringify(got)} (modello ${c && c.model})`);
    }
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('main: modello sconosciuto, il router elenca le voci → si riprova e si impara', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await installFakeRouter(app);
  const page = await openTab('filo://preferences/preferences.html');
  await app.evaluate(() => {
    globalThis.__vMode['acme/tts-x'] = {
      accept: ['acme-en-anna', 'acme-it-luca'],
      msg: 'Provider returned 400: {"error":"Unknown voice \\"\\". Supported voices: acme-en-anna, acme-it-luca."}',
    };
  });
  await setModel(app, 'acme/tts-x', '');
  const r1 = await synth(page, 'prima richiesta', 'it');
  expect(r1 && r1.ok, JSON.stringify(r1)).toBeTruthy();
  let c = await calls(app);
  expect(c.map((x) => x.voice)).toEqual(['', 'acme-it-luca']);
  // Seconda richiesta: niente 400 in più, voce imparata subito.
  const r2 = await synth(page, 'seconda richiesta', 'en');
  expect(r2 && r2.ok).toBeTruthy();
  c = await calls(app);
  expect(c.slice(2).map((x) => x.voice)).toEqual(['acme-en-anna']);
  // La tendina in Preferenze ora conosce le voci imparate.
  const info = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_voices' }));
  expect(info.model).toBe('acme/tts-x');
  const ids = (info.groups || []).flatMap((g) => g.voices.map((v) => v.id));
  expect(ids.sort()).toEqual(['acme-en-anna', 'acme-it-luca']);

  // Modello che PRETENDE una voce, senza catalogo e senza elenco: avviso chiaro
  await app.evaluate(() => { globalThis.__vMode['acme/tts-mute'] = { requireVoice: true }; });
  await setModel(app, 'acme/tts-mute', '');
  const r3 = await synth(page, 'terza richiesta', 'it');
  expect(r3.ok).toBeFalsy();
  expect(r3.errorCode).toBe('TTS_VOICE_REQUIRED');
  expect(String(r3.error)).toMatch(/Preferenze/);
  // Con la voce scritta a mano funziona
  await setModel(app, 'acme/tts-mute', 'muta-1');
  const r4 = await synth(page, 'quarta richiesta', 'it');
  expect(r4.ok, JSON.stringify(r4)).toBeTruthy();
  expect((await lastCall(app)).voice).toBe('muta-1');

  // Voce sbagliata a mano su mai-voice-2: il router risponde 400 senza elenco
  await app.evaluate(() => {
    globalThis.__vMode['microsoft/mai-voice-2'] = { accept: ['it-IT-ElsaNeural'], msg: 'Provider returned 400' };
  });
  await setModel(app, 'microsoft/mai-voice-2', 'nome-inventato');
  const r5 = await synth(page, 'quinta richiesta', 'it');
  console.log('VOCE INVENTATA su mai-voice-2 →', JSON.stringify(r5));
  console.log('CHIAMATE →', JSON.stringify((await calls(app)).slice(-3)));
});

test('pagina reale: Leggi manda la lingua della pagina e la voce del modello', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await installFakeRouter(app);
  await setModel(app, 'microsoft/mai-voice-2', '');
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_TTS?.readAloud === 'function', null, { timeout: 8000 });
  await page.evaluate(() => { document.documentElement.lang = 'en'; window.SN_TTS.readAloud('Hello world. This is a test.'); });
  await page.waitForFunction(() => false, null, { timeout: 2500 }).catch(() => {});
  const c = await calls(app);
  console.log('PAGINA en →', JSON.stringify(c));
  expect(c.length).toBeGreaterThan(0);
  for (const x of c) expect(x.voice).toBe('en-US-AvaNeural');

  await app.evaluate(() => { globalThis.__vCalls = []; });
  await setModel(app, 'deepgram/aura-2', '');
  const page2 = page;
  await page2.evaluate(() => { window.SN_TTS.stopReading(); document.documentElement.lang = 'it-IT'; window.SN_TTS.readAloud('Ciao mondo. Questa è una prova.'); });
  await page2.waitForFunction(() => false, null, { timeout: 2500 }).catch(() => {});
  const c2 = await calls(app);
  console.log('PAGINA it →', JSON.stringify(c2));
  expect(c2.length).toBeGreaterThan(0);
  for (const x of c2) expect(x.voice).toBe('aura-2-cinzia-it');

  // pagina senza lang
  await app.evaluate(() => { globalThis.__vCalls = []; });
  const page3 = page;
  await page3.evaluate(() => { window.SN_TTS.stopReading(); document.documentElement.removeAttribute('lang'); window.SN_TTS.readAloud('Senza lingua dichiarata.'); });
  await page3.waitForFunction(() => false, null, { timeout: 2500 }).catch(() => {});
  console.log('PAGINA senza lang →', JSON.stringify(await calls(app)));
});

test('preferenze: la tendina mostra le voci del modello in uso', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await installFakeRouter(app);

  async function openPrefs() {
    const p = await openTab('filo://preferences/preferences.html');
    await p.waitForFunction(() => {
      const s = document.getElementById('ttsModelVoiceModel');
      return s && /Modello:/.test(s.textContent);
    }, null, { timeout: 8000 }).catch(() => {});
    return p;
  }
  async function reloadPrefs(p) {
    await p.reload();
    await p.waitForFunction(() => {
      const s = document.getElementById('ttsModelVoiceModel');
      return s && /Modello:/.test(s.textContent);
    }, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(500);
  }
  async function readSel(p) {
    return p.evaluate(() => {
      const sel = document.getElementById('ttsModelVoice');
      const groups = [...sel.querySelectorAll('optgroup')].map((g) => ({ label: g.label, ids: [...g.querySelectorAll('option')].map((o) => o.value) }));
      const opts = [...sel.options].map((o) => ({ v: o.value, t: o.textContent }));
      const input = document.getElementById('ttsModelVoiceCustom');
      return {
        value: sel.value, groups, opts,
        model: document.getElementById('ttsModelVoiceModel').textContent,
        customHidden: input.hidden, customValue: input.value,
        firstLabel: opts[0] && opts[0].t,
      };
    });
  }

  await setModel(app, 'microsoft/mai-voice-2', '');
  let p = await openPrefs();
  let s = await readSel(p);
  console.log('PREF mai-voice-2 →', JSON.stringify({ ...s, opts: s.opts.length }));
  expect(s.model).toContain('microsoft/mai-voice-2');
  expect(s.groups[0].label.toLowerCase()).toBe('italiano');
  expect(s.groups[0].ids).toContain('it-IT-ElsaNeural');
  expect(s.groups[1].label.toLowerCase()).toBe('inglese');
  expect(s.value).toBe('');

  // Scelgo Diego e verifico che venga salvato e usato
  await p.selectOption('#ttsModelVoice', 'it-IT-DiegoNeural');
  await p.waitForTimeout(800);
  let saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
  console.log('SALVATO →', JSON.stringify(saved));
  expect(saved.modelVoice).toBe('it-IT-DiegoNeural');
  const r = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'prova dalle preferenze', lang: 'en' }));
  expect(r.ok, JSON.stringify(r)).toBeTruthy();
  expect((await lastCall(app)).voice).toBe('it-IT-DiegoNeural');

  // Cambio modello → aura-2: la voce salvata (Diego) è di un altro modello.
  await setModel(app, 'deepgram/aura-2', 'it-IT-DiegoNeural');
  await reloadPrefs(p);
  s = await readSel(p);
  console.log('PREF aura-2 con voce stantia →', JSON.stringify({ ...s, opts: s.opts.length }));
  expect(s.model).toContain('deepgram/aura-2');
  expect(s.groups[0].ids).toContain('aura-2-cinzia-it');
  // Cosa mostra la tendina con la voce stantia? (registrato sopra)
  const r2 = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'prova aura', lang: 'it' }));
  expect(r2.ok).toBeTruthy();
  expect((await lastCall(app)).voice).toBe('aura-2-cinzia-it');

  // Fish: sceglie da sé
  await setModel(app, 'fish-audio/s2-pro', '');
  await reloadPrefs(p);
  s = await readSel(p);
  console.log('PREF fish →', JSON.stringify({ ...s, opts: s.opts.length }));
  expect(s.groups).toEqual([]);
  expect(s.firstLabel).toMatch(/sceglie il modello/i);

  // Modello inventato: nessuna voce nota, il campo a mano dev'essere raggiungibile
  await setModel(app, 'acme/tts-x', '');
  await reloadPrefs(p);
  s = await readSel(p);
  console.log('PREF inventato →', JSON.stringify({ ...s, opts: s.opts.length }));
  expect(s.opts.some((o) => o.v === '__custom__')).toBeTruthy();
  await p.selectOption('#ttsModelVoice', '__custom__');
  await expect(p.locator('#ttsModelVoiceCustom')).toBeVisible();
  await p.fill('#ttsModelVoiceCustom', 'la-mia-voce');
  await p.waitForTimeout(900);
  saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
  expect(saved.modelVoice).toBe('la-mia-voce');
  const r3 = await p.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'prova inventato', lang: 'it' }));
  expect(r3.ok).toBeTruthy();
  expect((await lastCall(app)).voice).toBe('la-mia-voce');

  // Nessun modello di lettura impostato
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setSettings({ models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.TTS]: '' } });
  });
  await p.reload();
  await p.waitForTimeout(2000);
  s = await readSel(p);
  console.log('PREF senza modello →', JSON.stringify({ ...s, opts: s.opts.length }));

  // Modello cambiato mentre Preferenze è aperta: la tendina si aggiorna?
  await setModel(app, 'microsoft/mai-voice-2', '');
  await p.waitForTimeout(1500);
  s = await readSel(p);
  console.log('PREF dopo cambio a caldo →', JSON.stringify({ ...s, opts: s.opts.length }));

  // Screenshot per la traccia visiva
  await p.reload().catch(() => {});
  await p.waitForTimeout(1500);
  await p.locator('#ttsModelVoice').scrollIntoViewIfNeeded().catch(() => {});
  await p.screenshot({ path: 'tests/.shots/zz-verifica-voci-prefs.png' }).catch(() => {});
});

test('rilievo b: voce scritta a mano sbagliata per mai-voice-2 → cosa dice l\'avviso', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await installFakeRouter(app);
  await app.evaluate(() => {
    globalThis.__vMode['microsoft/mai-voice-2'] = { accept: ['it-IT-ElsaNeural'], msg: 'Provider returned 400' };
  });
  await setModel(app, 'microsoft/mai-voice-2', 'nome-inventato');
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_TTS?.readAloud === 'function', null, { timeout: 8000 });
  await page.evaluate(() => { document.documentElement.lang = 'it'; window.SN_TTS.readAloud('Prova con una voce sbagliata.'); });
  await page.waitForSelector('.sn-toast', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const toasts = await page.evaluate(() => [...document.querySelectorAll('.sn-toast')].map((t) => t.textContent.trim()));
  console.log('TOAST voce sbagliata →', JSON.stringify(toasts));
  console.log('CHIAMATE →', JSON.stringify(await calls(app)));
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForTimeout(1500);
  const r = await prefs.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'seconda prova voce sbagliata', lang: 'it' }));
  console.log('RISPOSTA main →', JSON.stringify(r));
  expect(toasts.length).toBeGreaterThan(0);
});
