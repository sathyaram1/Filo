// Verifica #541 giro 2: un fornitore scritto con il nome del catalogo
// («NovitaAI») vale come la voce del codice («Novita») in tutta la pagina.
import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';
const PRODUCERS = ['Google', 'OpenAI', 'xAI', 'DeepSeek', 'Mistral', 'Moonshot AI', 'MiniMax', 'Qwen', 'Cohere', 'Meta', 'Z.AI'];

async function openEditor(openTab, overrides = {}) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((over) => {
    const cfg = { apiKeysPresent: { openrouter: true, tavily: false }, safeBrowsingKeyPresent: false, modelRegistry: {}, models: {}, ...over };
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: cfg };
        case 'default_models_list': return { ok: true, items: [] };
        case 'default_providers_list':
          if (cfg.__noCatalog) return { ok: false, error: 'offline' };
          return { ok: true, items: [
            { name: 'DeepInfra', slug: 'deepinfra' },
            { name: 'NovitaAI', slug: 'novita' },
            { name: 'Together', slug: 'together' },
          ] };
        case 'defaults_update': return { ok: true, config: { ...cfg, ...msg.config } };
        default: return { ok: true };
      }
    };
    if (window.chrome && window.chrome.runtime) window.chrome.runtime.sendMessage = stub;
    else window.chrome = { runtime: { sendMessage: stub } };
  }, overrides);
  await page.reload();
  await expect(page.locator('#editor')).toBeVisible({ timeout: 8_000 });
  return page;
}

const noNovita = { excludedProviders: PRODUCERS, excludedProviderReasons: [] };

test('il refuso corretto col suggerimento chiude l\'avviso e prende il motivo di serie', async ({ openTab }) => {
  const page = await openEditor(openTab, noNovita);
  await expect(page.locator('#excludedDrift')).toBeVisible();
  await expect(page.locator('#excludedDriftText')).toContainText('Novita');
  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  await row.locator('.sn-excluded-name').fill('Novtia');
  await row.locator('.sn-excluded-guess').click();
  await expect(row.locator('.sn-excluded-name')).toHaveValue('NovitaAI');
  await expect(page.locator('#excludedDrift')).toBeHidden();
  await expect(row.locator('.sn-excluded-kind')).toHaveValue('unreliable');
  await expect(row.locator('.sn-excluded-note')).toHaveValue(/Banco di prova/);
  await page.click('#saveBtn');
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect(upd.config.excludedProviders.filter((n) => /novita/i.test(n))).toEqual(['NovitaAI']);
  expect(upd.config.excludedProviderReasons.find((r) => r.name === 'NovitaAI').kind).toBe('unreliable');
  await page.screenshot({ path: 'tests/.shots/verifica-541-g2-guess.png', fullPage: true });
});

test('scelto dal menu: avviso chiuso, motivo di serie, nessun doppione', async ({ openTab }) => {
  const page = await openEditor(openTab, noNovita);
  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  const input = row.locator('.sn-excluded-name');
  await input.fill('novi');
  await row.locator('.sn-select-option', { hasText: 'NovitaAI' }).click();
  await expect(input).toHaveValue('NovitaAI');
  await expect(page.locator('#excludedDrift')).toBeHidden();
  await expect(row.locator('.sn-excluded-kind')).toHaveValue('unreliable');
  await expect(page.locator('#excludedList .sn-excluded-row')).toHaveCount(PRODUCERS.length + 1);
});

test('la lista salvata col nome del catalogo non fa scattare l\'avviso al caricamento', async ({ openTab }) => {
  const page = await openEditor(openTab, { excludedProviders: [...PRODUCERS, 'NovitaAI'], excludedProviderReasons: [] });
  await expect(page.locator('#excludedList .sn-excluded-row')).toHaveCount(PRODUCERS.length + 1);
  await page.waitForTimeout(500);
  await expect(page.locator('#excludedDrift')).toBeHidden();
});
