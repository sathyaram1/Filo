// #948 — Il tasto microfono delle chat: si preme, si parla, il testo compare nella casella e la richiesta parte
// da sola dopo un attimo per annullare; con «Lascia il testo da correggere» resta nella casella. Home, Aiuto, Editor.
// Microfono finto (un tono: per il segmentatore è voce, spento è silenzio), trascrizione e chat finte nel main:
// tutto il resto (ascolto, fine del parlato, WAV, inserimento, invio) è il codice di produzione.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';

const SHOTS = 'tests/.shots';
const DETTO = 'che tempo fa domani a Lisbona';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

async function prepara(app, { tema = 'light' } = {}) {
  await app.evaluate(async (_e, { detto, tema: t }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: t,
      dictation: { autoSend: true },
    });
    globalThis.__trascrizioni = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
      globalThis.__trascrizioni += 1;
      const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
      return { text: ` ${detto} `, usage: { seconds: bytes / 32000, costUsd: 0.00001 }, generationId: null };
    };
    globalThis.__richieste = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      try { onDelta && onDelta('Domani c\'è il sole.'); } catch (_) {}
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: 'Domani c\'è il sole.', toolCalls: [], reasoningDetails: [], finishReason: 'stop',
      };
    };
  }, { detto: DETTO, tema });
}

// Un tono acceso/spento a comando al posto del microfono.
async function microfonoFinto(page) {
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
      window.__mic = { gain };
      return dest.stream;
    };
  });
}
const voce = (page, on) => page.evaluate((v) => { window.__mic.gain.gain.value = v ? 0.4 : 0; }, on);

async function home(app) {
  const page = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  return page;
}

// Parla per un secondo e mezzo e poi tace: il tasto deve smettere di ascoltare da solo.
async function parla(page, mic = page.locator('.dash-input-wrap .sn-voce-btn')) {
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
}

// Giro 4, rilievo 1: mentre il tasto trascrive l'ultima frase, Esc e Invio non vengono ascoltati e la frase parte da sola.
async function trascrizioneLenta(app, dallaPrima = false) {
  await app.evaluate((_e, primaLenta) => {
    let n = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      n += 1;
      const mio = n;
      if (mio >= 2 || primaLenta) await new Promise((r) => setTimeout(r, 3000));
      return { text: mio === 1 ? 'prima frase' : 'seconda frase', usage: { seconds: 1, costUsd: 0 }, generationId: null };
    };
  }, dallaPrima);
}

test('Esc mentre trascrive: quello che hai detto resta nella casella e non parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await trascrizioneLenta(app, true);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'trascrive', { timeout: 2_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#input')).toHaveValue('prima frase', { timeout: 8_000 });
  await page.waitForTimeout(4000);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  await expect(page.locator('#input')).toHaveValue('prima frase');
});

test('Invio a mano mentre trascrive: l\'ultima frase resta nella casella invece di partire come secondo messaggio', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await trascrizioneLenta(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1200);
  await voce(page, false);
  await expect(page.locator('#input')).toHaveValue('prima frase', { timeout: 5_000 });
  await voce(page, true);
  await page.waitForTimeout(1200);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'trascrive', { timeout: 2_000 });
  await page.locator('#input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'prima frase' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#input')).toHaveValue('seconda frase', { timeout: 8_000 });
  await page.waitForTimeout(4000);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
});
