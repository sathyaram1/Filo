// Verifica #1467 giro 3, esplorazione: una scheda chiusa con un'attività aperta si conta una volta sola.
import { test, expect } from '../../fixtures/electron.mjs';

const misura = (app, m) => app.evaluate(async (_e, m) => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora[m] || {})) out[c] = (out[c] || 0) + n;
  return out;
}, m);
const somma = (o) => Object.values(o).reduce((a, b) => a + b, 0);

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

const chiudi = (app, u) => app.evaluate(({ BrowserWindow }, u) => {
  const tm = BrowserWindow.getAllWindows().find((w) => !w._filoIncognito && w._filoTabs)._filoTabs;
  tm.closeTab(tm.tabs.find((t) => t.url === u).id);
}, u);

for (let giro = 0; giro < 3; giro++) {
  test(`dettatura lasciata nella casella, scheda chiusa: una sola ${giro}`, async ({ app, openTab }) => {
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
    const url = `filo://newtab/?prova=chiudi${giro}`;
    const page = await openTab(url);
    await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
    await microfonoFinto(page);
    const mic = page.locator('.dash-input-wrap .sn-voce-btn');
    await mic.click();
    await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.__mic.gain.gain.value = 0; });
    await expect(page.locator('#input')).toHaveValue('che tempo fa domani', { timeout: 15_000 });
    await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 10_000 });
    await chiudi(app, url);
    await expect.poll(async () => somma(await misura(app, 'dettatura')), { timeout: 8_000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 4000));
    expect(await misura(app, 'dettatura')).toEqual({ 'altro|f1|tenuta|no': 1 });
  });

  test(`aiuto, scheda chiusa: una sola ${giro}`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    const url = `filo://newtab/?prova=aiuto${giro}`;
    const page = await openTab(url);
    await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
    await page.evaluate(() => {
      const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg, ...rest) => {
        if (msg && msg.type === 'ai_request') return Promise.resolve({ ok: true, text: '{"text":"Ecco come si fa.","status":"done"}' });
        if (msg && msg.type === 'capture_visible_tab') return Promise.resolve({ ok: false });
        return orig(msg, ...rest);
      };
    });
    await page.evaluate(() => window.SN_SIDEBAR.open());
    await page.fill('.sn-sidebar-input textarea', 'come disdico?');
    await page.press('.sn-sidebar-input textarea', 'Enter');
    await expect(page.locator('.sn-sidebar-conv')).toContainText('Ecco come si fa.', { timeout: 20_000 });
    await chiudi(app, url);
    await expect.poll(async () => somma(await misura(app, 'aiuto')), { timeout: 8_000 }).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 4000));
    expect(somma(await misura(app, 'aiuto'))).toBe(1);
  });
}
