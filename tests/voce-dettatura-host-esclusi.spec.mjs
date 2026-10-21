// Voce e dettatura con un modello servito dal produttore escluso (#713, #1141): il router
// ignora la lista di esclusione sugli endpoint audio, quindi Filo legge prima chi serve il
// modello e, se non sono TUTTI ammessi, non chiama e dice perché; le Opzioni lo dicono mentre
// si sceglie il modello. Router finto nel main (fetch).

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { menuDi } from './helpers/menuContestuale.mjs';

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
        'voce-mista': { label: 'Voce mista', provider: 'openrouter', model: 'acme/voce-mista', inputs: ['text'], outputs: ['audio'] },
        'ascolto-misto': { label: 'Ascolto misto', provider: 'openrouter', model: 'acme/ascolto-misto', inputs: ['audio'], outputs: ['text'] },
        'ascolto-ignoto': { label: 'Ascolto ignoto', provider: 'openrouter', model: 'acme/ascolto-ignoto', inputs: ['audio'], outputs: ['text'] },
        'ascolto-libero': { label: 'Ascolto libero', provider: 'openrouter', model: 'acme/ascolto-libero', inputs: ['audio'], outputs: ['text'] },
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
      'acme/voce-mista': [{ provider_name: 'DeepInfra', tag: 'deepinfra' }, { provider_name: 'OpenAI', tag: 'openai' }],
      'acme/ascolto-misto': [{ provider_name: 'Groq', tag: 'groq' }, { provider_name: 'OpenAI', tag: 'openai' }],
      'acme/ascolto-libero': [{ provider_name: 'Groq', tag: 'groq' }, { provider_name: 'DeepInfra', tag: 'deepinfra' }],
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
  // Un campo qualunque: nella casella della chat «Detta» passa la mano al suo microfono (tests/voce-chat.spec.mjs).
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
    '<textarea id="campoDetta" style="position:fixed;top:60px;left:20px;width:320px;height:60px;z-index:9"></textarea>'));
  await page.locator('#campoDetta').focus();
  await page.locator('#campoDetta').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_TTS.startDictation());
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__fakeMic.gain.gain.value = 0; });

  const avviso = page.locator('.sn-toast', { hasText: 'Non ho mandato niente' });
  await expect(avviso).toBeVisible({ timeout: 10_000 });
  await expect(avviso).toContainText('openai/gpt-4o-transcribe');
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => document.querySelector('#campoDetta').value)).toBe('');
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

// #1141: basta UN host escluso fra quelli che servono il modello, o host che non si sanno, e la voce non parte.
test('Voce e dettatura: con un host escluso fra quelli del modello, o host ignoti, non parte niente e Filo dice perché', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, { tts: 'voce-mista', stt: 'ascolto-misto' });
  const page = await newtabPage(app);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  const detta = () => page.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.AI_REQUEST, action: window.SN_CONST.ACTIONS.TRANSCRIBE_AUDIO,
    payload: { audioBase64: 'UklGRiQAAABXQVZF', format: 'wav', lang: 'it-IT' },
  }));

  const voce = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'tts_synth', text: 'Ciao.', lang: 'it-IT' }));
  expect(voce.ok).toBe(false);
  expect(voce.errorCode).toBe('NO_ALLOWED_HOST');
  expect(voce.error).toContain('«acme/voce-mista» lo serve anche OpenAI, che Filo esclude');
  expect(voce.error).toContain('Non ho mandato niente');

  const ascolto = await detta();
  expect(ascolto.ok).toBe(false);
  expect(ascolto.code).toBe('NO_ALLOWED_HOST');
  expect(ascolto.error).toContain('«acme/ascolto-misto» lo serve anche OpenAI, che Filo esclude');

  const prova = await page.evaluate(() => chrome.runtime.sendMessage({
    type: 'test_provider', provider: 'openrouter', apiKey: 'k-test', model: 'acme/voce-mista', nickname: 'voce-mista',
  }));
  expect(prova.ok).toBe(false);
  expect(prova.error).toContain('lo serve anche OpenAI');

  // Chi serve il modello non si sa (il router risponde 404): si ferma anche lì.
  await preparaRouter(app, { tts: 'kokoro', stt: 'ascolto-ignoto' });
  const ignoto = await detta();
  expect(ignoto.code).toBe('NO_ALLOWED_HOST');
  expect(ignoto.error).toContain('Non so chi serve il modello «acme/ascolto-ignoto»');
  expect(await app.evaluate(() => globalThis.__audioCalls), 'nessuna richiesta audio è arrivata al router').toEqual([]);

  // Controprova: host tutti ammessi, la dettatura parte e trascrive.
  await preparaRouter(app, { tts: 'kokoro', stt: 'ascolto-libero' });
  const libero = await detta();
  expect(libero.ok).toBe(true);
  expect(libero.text).toBe('ciao');
  expect((await app.evaluate(() => globalThis.__audioCalls)).map((c) => c.model)).toEqual(['acme/ascolto-libero']);

  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});

test('Opzioni: scegliendo per voce o dettatura un modello che non partirebbe compare l\'avviso, e sparisce con uno buono', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, { tts: 'voce-mista', stt: 'ascolto-libero' });
  const modelli = await openTab('filo://options/options.html');
  await expect(modelli.locator('#modelsGrid .sn-chain input').first()).toBeVisible({ timeout: 8000 });
  const indice = (azione) => modelli.evaluate((a) => window.SN_MODEL_CHAIN.actionLabels().findIndex(([x]) => x === a), azione);
  const cella = async (azione) => modelli.locator('#modelsGrid > div').nth(await indice(azione));
  const voce = await cella('tts');
  const ascolto = await cella('transcribe_audio');

  // Il modello salvato si vede già all'apertura.
  await expect(voce.locator('.sn-chain-warn')).toHaveText(
    'Con «Voce mista» la lettura ad alta voce non parte: lo serve anche OpenAI, che Filo esclude.', { timeout: 8000 });
  await expect(ascolto.locator('.sn-chain-warn')).toBeHidden();

  // Scelto a mano: lo stesso avviso, e il modello resta quello scelto.
  const seg = ascolto.locator('.sn-chain-input').first();
  await seg.fill('ascolto-misto');
  await seg.dispatchEvent('change');
  await expect(ascolto.locator('.sn-chain-warn')).toHaveText(
    'Con «Ascolto misto» la dettatura non parte: lo serve anche OpenAI, che Filo esclude.');
  await expect(seg).toHaveValue('ascolto-misto');
  mkdirSync(SHOTS, { recursive: true });
  await modelli.screenshot({ path: `${SHOTS}/voce-dettatura-host-avviso-opzioni.png` });
  await modelli.keyboard.press('Escape');
  await modelli.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await voce.screenshot({ path: `${SHOTS}/voce-dettatura-host-avviso-cella-scura.png` });
  await modelli.evaluate(() => { delete document.documentElement.dataset.snTheme; });

  // Un modello con host tutti ammessi toglie l'avviso; uno ignoto lo dice a modo suo.
  const segVoce = voce.locator('.sn-chain-input').first();
  await segVoce.fill('kokoro');
  await segVoce.dispatchEvent('change');
  await expect(voce.locator('.sn-chain-warn')).toBeHidden();
  await seg.fill('ascolto-ignoto');
  await seg.dispatchEvent('change');
  await expect(ascolto.locator('.sn-chain-warn')).toHaveText(
    'Con «Ascolto ignoto» la dettatura non parte finché non so chi lo serve, e ora non riesco a saperlo.');

  // Le altre funzioni non chiedono niente al router.
  const lookups = await app.evaluate(() => globalThis.__hostLookups);
  expect(new Set(lookups)).toEqual(new Set(['acme/voce-mista', 'acme/ascolto-libero', 'acme/ascolto-misto', 'hexgrad/kokoro-82m', 'acme/ascolto-ignoto']));
  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});

test('Detta dal tasto destro: scegliere un modello che non partirebbe lo dice subito; da un sito vale solo un nome del registro', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, { tts: 'kokoro', stt: 'ascolto-libero' });
  const page = await newtabPage(app);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
    '<textarea id="campoDetta" style="position:fixed;top:60px;left:20px;width:320px;height:60px;z-index:9"></textarea>'));
  await page.locator('#campoDetta').focus();
  await page.locator('#campoDetta').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu').first();
  await expect(menu).toBeVisible();
  const detta = menu.locator('.sn-menu-split', { hasText: 'Detta' }).first();
  await detta.locator('.sn-menu-split-arrow').hover();
  const sub = menuDi(page).locator('.sn-menu-sub');
  await expect(sub).toBeVisible();
  await sub.locator('button', { hasText: 'Ascolto misto' }).first().click();
  const avviso = page.locator('.sn-toast', { hasText: 'Modello dettatura aggiornato' });
  await expect(avviso).toContainText('Con «Ascolto misto» la dettatura non parte: lo serve anche OpenAI, che Filo esclude.');
  await expect.poll(async () => (await app.evaluate(() => globalThis.SN_STORAGE.getSettings())).models.transcribe_audio)
    .toBe('ascolto-misto');
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/voce-dettatura-host-avviso-tasto-destro.png` });

  // Da un sito: un id qualunque non diventa una lettura al router, il nome del registro sì.
  const daSito = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const sito = { url: 'https://sito-ostile.example/pagina' };
    const send = (extra) => globalThis.SN_HANDLE_MESSAGE({ type: MSG.AUDIO_HOST_CHECK, action: 'transcribe_audio', ...extra }, sito);
    globalThis.__hostLookups = [];
    const crudo = await send({ provider: 'openrouter', model: 'acme/qualunque' });
    const nome = await send({ nickname: 'ascolto-misto' });
    return { crudo, nome, lookups: globalThis.__hostLookups };
  });
  expect(daSito.crudo.verdict).toBe('na');
  expect(daSito.nome.verdict).toBe('mixed');
  expect(daSito.lookups).not.toContain('acme/qualunque');
  await app.evaluate(() => { if (globalThis.__fetchVero) globalThis.fetch = globalThis.__fetchVero; });
});
