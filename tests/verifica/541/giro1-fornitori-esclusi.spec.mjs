// Verifica #541 giro 1: nome del fornitore escluso dal catalogo dello smistatore
// (refuso segnalato) e motivo per voce, provati dal lato dell'owner.
import { test, expect } from '../../fixtures/electron.mjs';

const ADMIN_URL = 'filo://admin-defaults/admin-defaults.html';

async function openEditor(openTab, overrides = {}) {
  const page = await openTab(ADMIN_URL);
  await page.addInitScript((over) => {
    const cfg = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: {},
      models: {},
      ...over,
    };
    window.__sent = [];
    const stub = async (msg) => {
      window.__sent.push(msg);
      switch (msg.type) {
        case 'defaults_get': return { ok: true, config: cfg };
        case 'default_models_list': return { ok: true, items: [] };
        case 'default_providers_list':
          return { ok: true, items: cfg.__catalog || [
            { name: 'DeepInfra', slug: 'deepinfra' },
            { name: 'NovitaAI', slug: 'novita' },
            { name: 'Together', slug: 'together' },
            { name: '<b>Evil</b>', slug: 'evil' },
          ] };
        case 'defaults_update':
          return { ok: true, config: {
            ...cfg,
            excludedProviders: msg.config.excludedProviders || cfg.excludedProviders,
            excludedProviderReasons: msg.config.excludedProviderReasons || cfg.excludedProviderReasons,
          } };
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

test('da tastiera si sceglie dal menu, le maiuscole non contano, un nome lontano non ha suggerimento', async ({ openTab }) => {
  const page = await openEditor(openTab, { excludedProviders: ['Novita'], excludedProviderReasons: [] });
  await page.click('#addExcludedRow');
  const row = page.locator('#excludedList .sn-excluded-row').last();
  const input = row.locator('.sn-excluded-name');
  await input.fill('toge');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('Together');
  await expect(row.locator('.sn-model-row-msg')).toBeEmpty();

  await input.fill('together');
  await expect(row.locator('.sn-model-row-msg')).toBeEmpty();

  await input.fill('Zzzzqqq');
  await expect(row.locator('.sn-model-row-msg')).toContainText('non esclude nessuno');
  await expect(row.locator('.sn-excluded-guess')).toHaveCount(0);

  // Il nome del catalogo con markup resta testo nel menu.
  await input.fill('');
  await input.blur();
  await input.focus();
  await expect(row.locator('.sn-select-option', { hasText: '<b>Evil</b>' })).toBeVisible();
  expect(await row.locator('.sn-select-pop b').count()).toBe(0);
});

test('il motivo cambiato da solo si salva, sopravvive al salvataggio e un secondo salvataggio non rimanda niente', async ({ openTab }) => {
  const page = await openEditor(openTab, {
    excludedProviders: ['Novita'],
    excludedProviderReasons: [{ name: 'Novita', kind: 'unreliable', note: 'x' }],
  });
  const row = page.locator('#excludedList .sn-excluded-row').first();
  await row.locator('.sn-excluded-kind').selectOption('producer');
  const long = '<img src=x onerror="window.__pwn=1">' + 'a'.repeat(10_000);
  await row.locator('.sn-excluded-note').fill(long);
  await page.click('#saveBtn');
  await expect(page.locator('#saveStatus')).toContainText(/salvat/i);
  const upd = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect('excludedProviders' in upd.config).toBe(false);
  expect(upd.config.excludedProviderReasons).toEqual([{ name: 'Novita', kind: 'producer', note: long }]);
  const r2 = page.locator('#excludedList .sn-excluded-row').first();
  await expect(r2.locator('.sn-excluded-kind')).toHaveValue('producer');
  await expect(r2.locator('.sn-excluded-note')).toHaveValue(long);
  expect(await page.evaluate(() => window.__pwn)).toBeUndefined();
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(width).toBe(true);

  await page.click('#saveBtn');
  const upd2 = await page.evaluate(() => window.__sent.filter((m) => m.type === 'defaults_update').pop());
  expect('excludedProviderReasons' in upd2.config).toBe(false);
  expect('excludedProviders' in upd2.config).toBe(false);
});

test('aspetto: lista di serie con un refuso, tema chiaro e scuro', async ({ openTab }) => {
  const page = await openEditor(openTab, {
    excludedProviders: ['Google', 'OpenAI', 'Novtia'],
    excludedProviderReasons: [{ name: 'Google', kind: 'producer', note: '' }],
    __catalog: [
      { name: 'Google Vertex', slug: 'google-vertex' },
      { name: 'OpenAI', slug: 'openai' },
      { name: 'NovitaAI', slug: 'novita' },
    ],
  });
  await expect(page.locator('#excludedList .sn-excluded-row').nth(2).locator('.sn-model-row-msg')).toContainText('Forse');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => window.SN_PAGE_BOOTSTRAP.applyTheme(t), theme);
    await page.locator('#sec-excluded').screenshot({ path: `tests/.shots/verifica-541-${theme}.png` });
  }
});

