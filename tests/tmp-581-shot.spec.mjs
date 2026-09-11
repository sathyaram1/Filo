// TEMPORANEO — cattura della pagina "Modelli predefiniti" nei due temi, per
// guardare i testi allungati dal #581. Da cancellare dopo l'occhiata.
import { test } from './fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

for (const tema of ['light', 'dark']) {
  test(`scatto ${tema}`, async ({ openTab }) => {
    const page = await openTab(ADMIN_URL);
    await page.addInitScript((t) => {
      const fakeConfig = {
        apiKeysPresent: { openrouter: true, tavily: false },
        safeBrowsingKeyPresent: true,
        modelRegistry: {},
        models: {},
        excludedProviders: [],
      };
      const stub = async (msg) => {
        if (msg.type === 'defaults_get') return { ok: true, config: fakeConfig };
        return { ok: true };
      };
      if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
      else window.chrome = { runtime: { sendMessage: stub } };
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.setAttribute('data-theme', t);
        document.documentElement.style.colorScheme = t;
      });
    }, tema);
    await page.reload();
    await page.waitForSelector('#editor', { timeout: 8000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/agent/.out/581-admin-${tema}.png`, fullPage: false });
  });
}
