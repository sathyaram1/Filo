// Verifica #1467 giro 1, r2: col «manda da solo» spento, la trascrizione corretta a mano e poi inviata si conta
// «cambiata», non «tenuta».
import { test, expect } from '../../fixtures/electron.mjs';

const DETTO = 'che tempo fa domani a Lisbona';

const dettature = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora.dettatura || {})) out[c] = (out[c] || 0) + n;
  return out;
});

test('r2 una dettatura corretta a mano prima dell’invio si conta cambiata anche senza invio automatico', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async (_e, detto) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ` ${detto} `, usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      try { onDelta && onDelta('Domani c\'è il sole.'); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: 'Domani c\'è il sole.', toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, DETTO);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
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
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__mic.gain.gain.value = 0; });
  // La trascrizione arriva nella casella e resta lì: la persona la corregge e la manda.
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 15_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  await page.locator('#input').fill('che tempo fa domani a Lisbona, in Portogallo');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'Portogallo' })).toBeVisible({ timeout: 15_000 });

  await expect.poll(async () => Object.keys(await dettature(app)).some((k) => /\|cambiata\|/.test(k)), { timeout: 5_000 }).toBe(true);
});
