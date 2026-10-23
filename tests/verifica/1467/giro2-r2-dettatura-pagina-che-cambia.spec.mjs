// Verifica #1467 giro 2, r2: una dettatura aperta su una pagina che se ne va (si naviga altrove nella stessa scheda) si
// conta quando la pagina se ne va, come la sessione dell'Aiuto e la lettura, non quando la scheda si chiuderà.
import { test, expect } from '../../fixtures/electron.mjs';

const misura = (app, m) => app.evaluate(async (_e, m) => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora[m] || {})) out[c] = (out[c] || 0) + n;
  return out;
}, m);

async function microfonoFinto(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain(); gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__mic = { gain };
      return dest.stream;
    };
  });
}

test('r2 la dettatura lasciata nella casella della home si conta quando la scheda va su un sito', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      dictation: { autoSend: false },
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' che tempo fa domani ', usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
  });
  const sito = testServer.html('<title>Meteo</title><p>Il sito del meteo.</p>', { pubblico: true });
  const page = await openTab('filo://newtab/?prova=dettatura-naviga');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__mic.gain.gain.value = 0; });
  await expect(page.locator('#input')).toHaveValue('che tempo fa domani', { timeout: 15_000 });
  await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
  expect(await misura(app, 'dettatura')).toEqual({});

  // La persona lascia perdere e ricarica la home, nella stessa scheda.
  await page.reload();
  await expect.poll(async () => Object.keys(await misura(app, 'dettatura')), { timeout: 8_000 }).toEqual([expect.stringMatching(/\|tenuta\|/)]);
});
