// Esplorazione: solo immagini della pagina per guardarla davvero. Si cancella.

import { test } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

const CONFIG = {
  apiKeysPresent: { openrouter: true, tavily: false },
  safeBrowsingKeyPresent: false,
  modelRegistry: {
    flash: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', sort: 'throughput' },
    pro: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', reasoning: 'high' },
    visione: { provider: 'openrouter', model: 'moonshotai/kimi-k2.6-vision', sort: 'latency' },
    tts: { provider: 'openrouter', model: 'qualcuno/voce-molto-lunga-di-nome', sort: 'price' },
  },
  models: {},
  excludedProviders: ['Google', 'OpenAI', 'Z.ai'],
  providerSort: 'price',
};

test('immagini della pagina dei modelli predefiniti nei due temi', async ({ app, openTab }) => {
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const page = await openTab(MODELLI_PREDEFINITI);
    await page.addInitScript((config) => {
      window.chrome = window.chrome || {};
      const attacca = () => {
        if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
        window.chrome.runtime.sendMessage = async (msg) => {
          switch (msg.type) {
            case 'defaults_get': return { ok: true, config };
            case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
            case 'defaults_update': return { ok: true, config };
            default: return { ok: true };
          }
        };
      };
      attacca();
    }, CONFIG);
    await page.reload();
    await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
    await page.waitForTimeout(400);
    await page.locator('#sec-model-registry').screenshot({ path: `tests/.shots/giro5-modelli-${tema}.png` });
  }
});
