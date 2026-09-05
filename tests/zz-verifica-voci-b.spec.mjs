// Verifica temporanea: la tendina delle voci in Preferenze segue il modello.
import { test, expect } from './fixtures/electron.mjs';

const REG = {
  mai: { label: 'MAI Voice 2', provider: 'openrouter', model: 'microsoft/mai-voice-2', inputs: ['text'], outputs: ['audio'] },
  fish: { label: 'Fish', provider: 'openrouter', model: 'fish-audio/s2-pro', inputs: ['text'], outputs: ['audio'] },
  aura: { label: 'Aura 2', provider: 'openrouter', model: 'deepgram/aura-2', inputs: ['text'], outputs: ['audio'] },
  boh: { label: 'Inventato', provider: 'openrouter', model: 'acme/voce-inventata', inputs: ['text'], outputs: ['audio'] },
  kokoro: { label: 'Kokoro', provider: 'openrouter', model: 'hexgrad/kokoro-82m', inputs: ['text'], outputs: ['audio'], weights: 'open' },
};

async function setTts(app, nick, ttsPrefs = {}) {
  await app.evaluate(async ({ nick, ttsPrefs, REG }) => {
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

async function stubProvider(app) {
  await app.evaluate(() => {
    if (!globalThis.__origOR) globalThis.__origOR = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.__ttsCalls = [];
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origOR,
      synthesizeSpeech: async ({ model, text, voice, speed }) => {
        globalThis.__ttsCalls.push({ model, text, voice: voice || '', speed });
        return { audioBase64: Buffer.alloc(8000).toString('base64'), mimeType: 'audio/L16;rate=8000', generationId: null };
      },
    };
  });
}

const stato = (page) => page.evaluate(() => {
  const sel = document.getElementById('ttsModelVoice');
  const input = document.getElementById('ttsModelVoiceCustom');
  return {
    value: sel.value,
    selectedText: sel.options[sel.selectedIndex]?.textContent,
    groups: [...sel.querySelectorAll('optgroup')].map((g) => `${g.label}(${g.children.length})`),
    nOptions: sel.options.length,
    customHidden: input.hidden,
    customValue: input.value,
    modelLabel: document.getElementById('ttsModelVoiceModel').textContent,
    modelTitle: document.getElementById('ttsModelVoiceModel').title,
    firstOption: sel.options[0].textContent,
  };
});

async function openPrefs(openTab) {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#ttsModelVoice');
  await page.waitForTimeout(600);
  return page;
}

test.describe('tendina voci in Preferenze', () => {
  test('nessun modello di lettura', async ({ app, openTab }) => {
    await setTts(app, '');
    const page = await openPrefs(openTab);
    const s = await stato(page);
    console.log('[verifica] nessun modello →', JSON.stringify(s));
    expect(s.groups).toEqual([]);
    expect(s.modelLabel).toMatch(/nessun modello/i);
    expect(s.value).toBe('');
  });

  test('mai-voice-2: voci Azure raggruppate per lingua, italiano prima', async ({ app, openTab }) => {
    await setTts(app, 'mai');
    const page = await openPrefs(openTab);
    const s = await stato(page);
    console.log('[verifica] mai →', JSON.stringify(s));
    expect(s.groups[0]).toMatch(/^Italiano\(/);
    expect(s.groups[1]).toMatch(/^Inglese\(/);
    expect(s.modelLabel).toContain('microsoft/mai-voice-2');
    expect(s.value).toBe('');
    expect(s.customHidden).toBe(true);
    // scelgo Diego, salvo, riapro: resta
    await page.selectOption('#ttsModelVoice', 'it-IT-DiegoNeural');
    await page.waitForTimeout(700);
    const saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
    console.log('[verifica] salvato →', JSON.stringify(saved));
    expect(saved.modelVoice).toBe('it-IT-DiegoNeural');
    await page.reload();
    await page.waitForSelector('#ttsModelVoice');
    await page.waitForTimeout(600);
    expect((await stato(page)).value).toBe('it-IT-DiegoNeural');
  });

  test('voce salvata da un altro modello: la tendina torna automatica', async ({ app, openTab }) => {
    await setTts(app, 'mai', { modelVoice: 'im_nicola' });
    const page = await openPrefs(openTab);
    const s = await stato(page);
    console.log('[verifica] mai+im_nicola →', JSON.stringify(s));
    expect(s.value).toBe('');
    expect(s.customHidden).toBe(true);
    // e un salvataggio della pagina (es. cambio velocità) pulisce la voce vecchia?
    await page.evaluate(() => {
      const r = document.getElementById('ttsRate');
      r.value = '1.2';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(900);
    const saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
    console.log('[verifica] dopo cambio velocità →', JSON.stringify(saved));
  });

  test('voce scritta a mano: finisce nel campo «altra voce»', async ({ app, openTab }) => {
    await setTts(app, 'mai', { modelVoice: 'it-IT-FabiolaNeural' });
    const page = await openPrefs(openTab);
    const s = await stato(page);
    console.log('[verifica] mai+a mano →', JSON.stringify(s));
    expect(s.value).toBe('__custom__');
    expect(s.customHidden).toBe(false);
    expect(s.customValue).toBe('it-IT-FabiolaNeural');
    // scrivo un altro nome e salvo
    await page.fill('#ttsModelVoiceCustom', 'it-IT-PalmiraNeural');
    await page.waitForTimeout(1200);
    const saved = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
    expect(saved.modelVoice).toBe('it-IT-PalmiraNeural');
    // torno ad automatica
    await page.selectOption('#ttsModelVoice', '');
    await page.waitForTimeout(700);
    const saved2 = await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tts);
    expect(saved2.modelVoice).toBe('');
    expect((await stato(page)).customHidden).toBe(true);
  });

  test('fish, aura, inventato, kokoro', async ({ app, openTab }) => {
    await setTts(app, 'fish');
    const page = await openPrefs(openTab);
    let s = await stato(page);
    console.log('[verifica] fish →', JSON.stringify(s));
    expect(s.groups).toEqual([]);
    expect(s.firstOption).toMatch(/sceglie il modello/i);
    expect(s.modelLabel).toContain('fish-audio/s2-pro');

    await setTts(app, 'aura');
    await page.reload(); await page.waitForSelector('#ttsModelVoice'); await page.waitForTimeout(600);
    s = await stato(page);
    console.log('[verifica] aura →', JSON.stringify(s));
    expect(s.groups[0]).toMatch(/^Italiano\(/);
    expect(s.modelLabel).toContain('deepgram/aura-2');

    await setTts(app, 'boh');
    await page.reload(); await page.waitForSelector('#ttsModelVoice'); await page.waitForTimeout(600);
    s = await stato(page);
    console.log('[verifica] inventato →', JSON.stringify(s));
    expect(s.groups).toEqual([]);
    expect(s.modelLabel).toContain('acme/voce-inventata');

    await setTts(app, 'kokoro');
    await page.reload(); await page.waitForSelector('#ttsModelVoice'); await page.waitForTimeout(600);
    s = await stato(page);
    console.log('[verifica] kokoro →', JSON.stringify(s));
    expect(s.groups[0]).toMatch(/^Italiano\(2\)/);
  });

  test('«Ascolta» manda la voce giusta al modello', async ({ app, openTab }) => {
    await stubProvider(app);
    await setTts(app, 'mai');
    const page = await openPrefs(openTab);
    await page.click('#ttsModelPreview');
    await page.waitForTimeout(1500);
    let c = await app.evaluate(() => globalThis.__ttsCalls);
    let st = await page.evaluate(() => document.getElementById('ttsModelPreviewStatus').textContent);
    console.log('[verifica] ascolta auto →', JSON.stringify(c), 'status:', st);
    expect(c.length).toBe(1);
    expect(c[0].voice).toMatch(/Neural$/);
    // scelgo inglese Ava
    await page.selectOption('#ttsModelVoice', 'en-US-AvaNeural');
    await page.waitForTimeout(600);
    await app.evaluate(() => { globalThis.__ttsCalls = []; });
    await page.click('#ttsModelPreview');
    await page.waitForTimeout(1500);
    c = await app.evaluate(() => globalThis.__ttsCalls);
    console.log('[verifica] ascolta Ava →', JSON.stringify(c));
    expect(c[0].voice).toBe('en-US-AvaNeural');
    expect(c[0].text).toMatch(/^Hi, I am Filo/);
  });

  test('cambio modello mentre Preferenze è aperta', async ({ app, openTab }) => {
    await setTts(app, 'kokoro');
    const page = await openPrefs(openTab);
    expect((await stato(page)).modelLabel).toContain('kokoro');
    await setTts(app, 'mai');
    await page.waitForTimeout(1200);
    const s = await stato(page);
    console.log('[verifica] cambio modello a pagina aperta →', JSON.stringify(s));
  });
});
