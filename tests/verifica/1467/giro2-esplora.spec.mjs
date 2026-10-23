// Verifica #1467 giro 2, esplorazione: le attività aperte su una pagina web vera che si chiude o se ne va.
import { test, expect } from '../../fixtures/electron.mjs';

const misura = (app, m) => app.evaluate(async (_e, m) => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora[m] || {})) out[c] = (out[c] || 0) + n;
  return out;
}, m);
const chiudiScheda = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const tm = BrowserWindow.getAllWindows().find((w) => !w._filoIncognito && w._filoTabs)._filoTabs;
  tm.closeTab(tm.tabs.find((t) => t.url === u).id);
}, url);

test('aiuto su un sito vero, scheda chiusa', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, '<html><body><h1>Negozio</h1><button>Disdici</button></body></html>');
  const url = page.url();
  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 }).catch(() => {});
  const haSidebar = await page.evaluate(() => typeof window.SN_SIDEBAR?.open === 'function');
  test.skip(!haSidebar, 'SN_SIDEBAR non esposto sulle pagine web');
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
  await chiudiScheda(app, url);
  await expect.poll(() => misura(app, 'aiuto'), { timeout: 8_000 }).toEqual({ 'fatto|p0|p0|n0|n0': 1 });
});

test('aiuto su un sito, la scheda naviga altrove e poi si chiude: una sessione sola', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const altra = testServer.html('<html><body>altra</body></html>');
  const page = await testServer.openReady(openTab, '<html><body><h1>Negozio</h1></body></html>');
  const haSidebar = await page.evaluate(() => typeof window.SN_SIDEBAR?.open === 'function');
  test.skip(!haSidebar, 'SN_SIDEBAR non esposto sulle pagine web');
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
  await page.evaluate((u) => { location.href = u; }, altra);
  await page.waitForURL(altra);
  await page.waitForTimeout(800);
  const dopoNav = await misura(app, 'aiuto');
  await chiudiScheda(app, altra);
  await page.waitForTimeout(1500);
  expect({ dopoNav, fine: await misura(app, 'aiuto') }).toEqual({ dopoNav: { 'fatto|p0|p0|n0|n0': 1 }, fine: { 'fatto|p0|p0|n0|n0': 1 } });
});

test('dettatura in ascolto nella home, scheda chiusa', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => ({ text: ' ciao ', usage: { seconds: 1, costUsd: 0.00001 }, generationId: null });
  });
  const url = 'filo://newtab/?prova=dett';
  const page = await openTab(url);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain(); gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      return dest.stream;
    };
  });
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(800);
  await chiudiScheda(app, url);
  await expect.poll(async () => Object.keys(await misura(app, 'dettatura')), { timeout: 8_000 }).toHaveLength(1);
});
