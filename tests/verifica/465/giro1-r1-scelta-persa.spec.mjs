// Verifica #465, giro 1, rilievo 1: la catena della ricerca fra i feedback, finché non
// la si salva in Gestione, vive ancora nei modelli di prima; salvare quelle pagine la cancella.
import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN = 'filo://admin-defaults/admin-defaults.html';
const OPTIONS = 'filo://options/options.html';

test('salvare Modelli predefiniti non cancella il modello della ricerca fra i feedback', async ({ openTab }) => {
  const page = await openTab(ADMIN);
  await page.addInitScript(() => {
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { flash: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } },
      models: { manage_search: 'flash', explain: 'flash' },
      excludedProviders: null,
    };
    if (fakeConfig.excludedProviders == null) {
      Object.defineProperty(fakeConfig, 'excludedProviders', {
        get: () => (window.SN_CONST && window.SN_CONST.DEFAULT_EXCLUDED_PROVIDERS) || [],
      });
    }
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: fakeConfig };
        case 'defaults_update': return { ok: true, config: fakeConfig };
        case 'default_models_list': return { ok: true, provider: 'openrouter', items: [] };
        case 'default_providers_list': return { ok: true, items: [] };
        default: return { ok: true };
      }
    };
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    try { window.chrome.runtime.sendMessage = stub; } catch (_) {}
  });
  await page.reload();
  await page.waitForSelector('#modelsGrid label', { timeout: 10_000 });

  await page.locator('#saveBtn').click();
  await expect.poll(() => page.evaluate(() => window.__sent.some((m) => m.type === 'defaults_update'))).toBe(true);
  const saved = await page.evaluate(() => window.__sent.find((m) => m.type === 'defaults_update').config.models);
  // La ricerca non si vede più qui, ma finché Gestione non ha la sua scelta è questa che usa.
  expect(saved.manage_search).toBe('flash');
});

test('un cambio nelle Opzioni, coi modelli propri, non cancella il modello della ricerca fra i feedback', async ({ openTab }) => {
  const page = await openTab(OPTIONS);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => chrome.runtime.sendMessage({
    type: 'update_settings',
    settings: {
      useDefaultModels: false,
      modelRegistry: { flash: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } },
      models: { manage_search: 'flash', explain: 'flash' },
    },
  }));
  await page.reload();
  await page.waitForSelector('#modelsGrid .sn-chain-input', { timeout: 10_000 });

  await page.locator('#monthlyLimit').fill('7');
  await page.locator('#monthlyLimit').dispatchEvent('change');
  await expect.poll(async () => (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'get_settings' })))?.monthlyLimitEur ?? null,
    { timeout: 8_000 }).toBe(7);

  const s = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'get_settings' }));
  expect(s.models.manage_search).toBe('flash');
});
