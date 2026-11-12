// Verifica #1467, giro 4: una porta del giro 2 ri-provata (Detta in una casella di ricerca, Invio mentre ascolta): chiusa.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const dettature = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const C = globalThis.SN_CONTATORI;
  const g = C.giornoDi(Date.now());
  const out = {};
  for (const [k, ora] of Object.entries(s.ore || {})) {
    if (!k.startsWith(`${g}T`)) continue;
    for (const [c, n] of Object.entries(ora.dettatura || {})) out[c] = (out[c] || 0) + n;
  }
  return out;
});

test('Detta in una casella di ricerca, Invio mentre ascolta: la dettatura si conta subito, una volta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry }, models: { ...globalThis.SN_TEST_MODELS.models },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' gatti neri ', usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
  });
  const page = await openTab('filo://newtab/?prova=detta');
  await page.waitForFunction(() => typeof window.SN_TTS?.startDictation === 'function', null, { timeout: 10_000 });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
    '<form id="f" action="filo://newtab/" method="get" style="position:fixed;top:60px;left:20px;z-index:9"><input id="q" name="q" style="width:320px"></form>'));
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
  await page.locator('#q').focus();
  await page.locator('#q').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_TTS.startDictation());
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__fakeMic.gain.gain.value = 0; });
  await expect.poll(() => page.evaluate(() => document.querySelector('#q').value), { timeout: 10_000 }).toMatch(/gatti/);
  // Ancora in ascolto: Invio nella casella, il sito passa ai risultati.
  await expect(page.locator('.sn-dictate-pill')).toBeVisible();
  await page.locator('#q').press('Enter');
  await page.waitForURL(/\?q=/, { timeout: 10_000 });
  await expect.poll(() => dettature(app), { timeout: 8_000 }).toEqual({ 'altro|f1|nessuno|si': 1 });
});
