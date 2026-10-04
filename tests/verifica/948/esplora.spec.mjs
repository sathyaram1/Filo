// Esplorazione del verificatore #948 giro 3: tema scuro, Preferenze, chat occupata, secondo giro di voce.
import { test, expect } from '../../fixtures/electron.mjs';
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

async function prepara(app, { tema = 'dark', lento = 0 } = {}) {
  await app.evaluate(async (_e, { detto, tema: t, lento: l }) => {
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
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ` ${detto} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
    globalThis.__richieste = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      if (l) await new Promise((r) => setTimeout(r, l));
      try { onDelta && onDelta('Risposta.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Risposta.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, { detto: DETTO, tema, lento });
}

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

test('scuro: home, ascolto, attesa, editor, Preferenze', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  mkdirSync(SHOTS, { recursive: true });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await expect(mic).toBeVisible();
  await page.locator('.dash-input-wrap').screenshot({ path: `${SHOTS}/v948-scuro-home-pronto.png` });
  await mic.hover();
  await page.locator('.dash-input-wrap').screenshot({ path: `${SHOTS}/v948-scuro-home-hover.png` });
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(600);
  await page.locator('.dash-input-wrap').screenshot({ path: `${SHOTS}/v948-scuro-home-ascolta.png` });
  await page.waitForTimeout(900);
  await voce(page, false);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.locator('.dash-input-wrap').screenshot({ path: `${SHOTS}/v948-scuro-home-attesa.png` });
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: `${SHOTS}/v948-scuro-home-dopo.png` });

  // Secondo giro subito dopo: lo stesso tasto riparte.
  await voce(page, true);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toHaveCount(2, { timeout: 15_000 });

  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  await chat.screenshot({ path: `${SHOTS}/v948-scuro-editor.png` });

  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.locator('#dictationAutoSend').scrollIntoViewIfNeeded();
  await prefs.screenshot({ path: `${SHOTS}/v948-scuro-prefs.png` });
});

test('home occupata: la voce aspetta la risposta in corso e poi parte, senza perdere niente', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, { tema: 'light', lento: 6000 });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await page.locator('#input').fill('primo messaggio scritto');
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'primo messaggio scritto' })).toBeVisible({ timeout: 5_000 });
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await page.waitForTimeout(2800);
  await page.locator('.dash-input-wrap').screenshot({ path: `${SHOTS}/v948-occupata.png` });
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => app.evaluate(() => globalThis.__richieste.length), { timeout: 15_000 }).toBe(2);
});

test('scritto e poi detto: parte tutto insieme, una volta', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, { tema: 'light' });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await page.locator('#input').fill('dimmi');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
  await expect(page.locator('.dash-bubble-user', { hasText: `dimmi ${DETTO}` })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(1);
});
