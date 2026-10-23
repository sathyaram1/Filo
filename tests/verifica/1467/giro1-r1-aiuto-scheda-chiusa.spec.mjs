// Verifica #1467 giro 1, r1: una sessione dell'Aiuto finita chiudendo la scheda (senza la × del pannello) si conta
// come quella chiusa dal pannello.
import { test, expect } from '../../fixtures/electron.mjs';

const aiuto = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora.aiuto || {})) out[c] = (out[c] || 0) + n;
  return out;
});

test('r1 l’Aiuto aperto su una scheda che si chiude conta la sessione', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const url = 'filo://newtab/?prova=r1';
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
  await page.fill('.sn-sidebar-input textarea', 'come disdico l\'abbonamento?');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await expect(page.locator('.sn-sidebar-conv')).toContainText('Ecco come si fa.', { timeout: 20_000 });
  expect(await aiuto(app)).toEqual({});

  // La persona ha letto la risposta e chiude la scheda, come si fa di solito.
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((w) => !w._filoIncognito && w._filoTabs)._filoTabs;
    tm.closeTab(tm.tabs.find((t) => t.url === u).id);
  }, url);

  await expect.poll(() => aiuto(app), { timeout: 8_000 }).toEqual({ 'fatto|p0|p0|n0|n0': 1 });
});
