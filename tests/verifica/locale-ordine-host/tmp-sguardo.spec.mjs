// Esplorazione: guarda la pagina davvero. Si cancella a fine giro.
import { test } from '../../fixtures/electron.mjs';

const MODELLI_PREDEFINITI = 'filo://admin-defaults/admin-defaults.html';

test('sguardo', async ({ openTab }) => {
  const page = await openTab(MODELLI_PREDEFINITI);
  await page.addInitScript(() => {
    const config = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {
        veloce: { provider: 'openrouter', model: 'z-ai/glm-4.7', sort: 'throughput' },
        normale: { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', reasoning: 'high' },
        voce: { provider: 'openrouter', model: 'typesafe/jev-latest', sort: 'price' },
      },
      models: {},
      excludedProviders: ['Google', 'OpenAI'],
      providerSort: 'price',
    };
    window.chrome = window.chrome || {};
    const attacca = () => {
      if (!window.chrome || !window.chrome.runtime) { setTimeout(attacca, 5); return; }
      const vero = window.chrome.runtime.sendMessage.bind(window.chrome.runtime);
      window.chrome.runtime.sendMessage = async (msg) => {
        switch (msg.type) {
          case 'defaults_get': return { ok: true, config };
          case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
          case 'defaults_update': return { ok: true, config };
          case 'test_default_model': return { ok: true, ttftMs: 42, tokensPerSec: 77.7 };
          default: return vero(msg);
        }
      };
    };
    attacca();
  });
  await page.reload();
  await page.waitForSelector('#modelRegistryList .sn-model-row:not(.sn-model-row-head)', { timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/g4-chiaro.png', fullPage: false });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/g4-scuro.png', fullPage: false });
});
