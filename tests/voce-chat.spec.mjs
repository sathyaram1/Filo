// #948 — Il tasto microfono delle chat: si preme, si parla, il testo compare nella casella e la richiesta parte
// da sola dopo un attimo per annullare; con «Lascia il testo da correggere» resta nella casella.
// Microfono finto (un tono: per il segmentatore è voce, spento è silenzio), trascrizione e chat finte nel main:
// tutto il resto (ascolto, fine del parlato, WAV, inserimento, invio) è il codice di produzione.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

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
async function parla(page) {
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
}

test('home: il microfono si vede accanto all\'invio, si parla e la richiesta parte senza altri clic', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  mkdirSync(SHOTS, { recursive: true });

  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await expect(mic).toBeVisible();
  // Accanto all'invio, prima di lui.
  const vicini = await page.evaluate(() => {
    const m = document.querySelector('.dash-input-wrap .sn-voce-btn');
    return m.nextElementSibling && m.nextElementSibling.id;
  });
  expect(vicini).toBe('sendBtn');
  // Hover di una parola e la scorciatoia, col nome che le dà questo sistema.
  const tasto = await page.evaluate(() => window.SN_TASTI.etichetta(window.SN_VOCE_CHAT.TASTO));
  await expect(mic).toHaveAttribute('title', `Parla (${tasto})`);
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-pronto.png` });

  await mic.click();
  await parla(page);
  // Il testo detto compare nella casella e c'è l'attimo per annullare…
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'attesa');
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-attesa.png` });
  // …poi la richiesta parte da sola: la bolla dell'utente, la risposta, la casella vuota.
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Domani c\'è il sole.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#input')).toHaveValue('');
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  const richieste = await app.evaluate(() => globalThis.__richieste);
  expect(richieste.some((r) => r.includes(DETTO))).toBe(true);
});

test('home: nell\'attimo per annullare, la croce ferma l\'invio e il testo resta da correggere', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');

  // Anche la scorciatoia accende il microfono.
  await page.locator('#input').focus();
  await page.keyboard.press('Control+Shift+Space');
  await parla(page);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await expect(mic).toHaveAttribute('title', /Annulla l'invio/);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await page.waitForTimeout(3500);
  await expect(page.locator('#input')).toHaveValue(DETTO);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
});

test('home: con «Lascia il testo da correggere» (scelto dal tasto destro sul microfono) il testo resta nella casella', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, { tema: 'dark' });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');

  // Il tasto destro sul microfono offre le due scelte; quella di serie è segnata.
  await mic.click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('✓ Invia da solo')).toBeVisible();
  await menu.getByText('Lascia il testo da correggere').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).dictation.autoSend)).toBe(false);

  await mic.click();
  await parla(page);
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await page.waitForTimeout(3500);
  await expect(page.locator('#input')).toHaveValue(DETTO);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
  // Il cursore è in fondo al testo, pronto per correggere.
  expect(await page.evaluate(() => {
    const i = document.querySelector('#input');
    return document.activeElement === i && i.selectionStart === i.value.length;
  })).toBe(true);

  // Il tema scuro: il tasto acceso si vede.
  await voce(page, true);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-ascolta-scuro.png` });
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
});

test('microfono negato: un avviso dice cosa fare e il tasto torna pronto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(page.locator('.sn-toast', { hasText: 'non ha il permesso di usare il microfono' })).toBeVisible({ timeout: 5_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
});

test('trascrizione fallita: un avviso lo dice e niente parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await app.evaluate(() => {
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => { throw new Error('fetch failed'); };
  });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page);
  await expect(page.locator('.sn-toast', { hasText: 'Non sono riuscito a trascrivere' })).toBeVisible({ timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await expect(page.locator('#input')).toHaveValue('');
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
});
