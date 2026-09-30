// Esplorazione della verifica #465 (si cancella a fine giro).
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ADMIN = 'filo://admin-defaults/admin-defaults.html';
const OPTIONS = 'filo://options/options.html';

async function stubManage(page, over = {}) {
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate((over) => {
    window.__sent = [];
    const orig = window.filo.message.bind(window.filo);
    const models = Object.assign({
      sanitizer: 'flash', judge1: 'giudice-veloce', judge2: '', judge3: '', judgeDynamic: '',
      judgeRedTeam: '', judgePriority: '', manageSearch: 'flash, flash-or',
      judgeRegistry: { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } },
      sharedNicknames: [{ nick: 'flash', label: '' }, { nick: 'flash-or', label: '' }, { nick: 'kimi', label: 'Kimi' }],
      openrouterKeyPresent: true,
    }, over);
    window.__models = models;
    window.filo.message = async (msg) => {
      window.__sent.push(JSON.parse(JSON.stringify(msg)));
      if (msg.type === 'support_models_get') return { ok: true, models: JSON.parse(JSON.stringify(window.__models)) };
      if (msg.type === 'support_models_update') {
        const m = Object.assign({}, window.__models, msg.models, { judgeRegistry: msg.judgeRegistry });
        window.__models = m;
        return { ok: true, models: JSON.parse(JSON.stringify(m)) };
      }
      if (msg.type === 'default_models_list') {
        return { ok: true, provider: 'openrouter', items: [
          { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Testo' },
          { id: 'moonshotai/kimi-k2.6', label: 'Multimodale' },
          { id: 'deepseek/deepseek-v4-flash', label: 'Testo' },
        ] };
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  }, over);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible();
}

test('gestione: slot ricerca, suggerimenti nickname e catalogo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await stubManage(page);

  const slot = page.locator('.mg-sm-slot[data-slot="manageSearch"]');
  await expect(slot).toBeVisible();
  await expect(slot.locator('label')).toHaveText('Ricerca fra i feedback');
  const vals = await slot.locator('.sn-chain-input').evaluateAll((els) => els.map((e) => e.value));
  console.log('manageSearch chain', vals);

  // suggerimenti nickname mentre scrivo nello slot
  const inp = slot.locator('.sn-chain-input').first();
  await inp.click();
  await inp.fill('');
  await inp.type('ki');
  await page.waitForTimeout(300);
  const pop1 = await slot.locator('.sn-chain-pop, .sn-select-option').allTextContents();
  console.log('slot pop', pop1);

  // catalogo nel campo modello del registro
  const model = page.locator('#mgSmRegistryList .sn-model-id').first();
  await model.click();
  await model.fill('');
  await model.type('nemo');
  await page.waitForTimeout(300);
  const pop2 = await page.locator('#mgSmRegistryList .sn-select-option').allTextContents();
  console.log('registry pop', pop2);
  await page.screenshot({ path: 'tests/.shots/v465-registro-light.png' });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP && window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/v465-registro-dark.png' });
  await page.keyboard.press('Escape');
  await inp.click();
  await inp.fill('');
  await inp.type('fl');
  await page.waitForTimeout(300);
  await slot.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v465-slot-dark.png' });
  console.log('catalog calls', await page.evaluate(() => window.__sent.filter((m) => m.type === 'default_models_list').length));
});

test('gestione: slot spostato mai impostato (null) e salvataggio', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await stubManage(page, { manageSearch: null });
  const slot = page.locator('.mg-sm-slot[data-slot="manageSearch"]');
  const vals = await slot.locator('.sn-chain-input').evaluateAll((els) => els.map((e) => e.value));
  console.log('null slot chain', vals);
  await page.locator('#mgSmSaveBtn').click();
  await page.waitForTimeout(500);
  const upd = await page.evaluate(() => window.__sent.find((m) => m.type === 'support_models_update'));
  console.log('update payload models', JSON.stringify(upd && upd.models));
});

test('modelli predefiniti: la ricerca non c\'è e il salvataggio la toglie dai modelli', async ({ openTab }) => {
  const page = await openTab(ADMIN);
  await page.addInitScript(() => {
    const fakeConfig = {
      apiKeysPresent: { openrouter: true, tavily: false },
      safeBrowsingKeyPresent: false,
      modelRegistry: { flash: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } },
      models: { manage_search: 'flash', explain: 'flash' },
      excludedProviders: null,
    };
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
    const install = () => {
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
      try { window.chrome.runtime.sendMessage = stub; } catch (_) {}
    };
    install();
  });
  await page.reload();
  await page.waitForSelector('#modelsGrid label', { timeout: 10_000 });
  const labels = await page.locator('#modelsGrid label').allTextContents();
  console.log('admin grid has ricerca:', labels.some((l) => /ricerca fra i feedback/i.test(l)), labels.length);
  await page.locator('#saveBtn').click();
  await page.waitForTimeout(500);
  const upd = await page.evaluate(() => window.__sent.find((m) => m.type === 'defaults_update'));
  console.log('admin save models has manage_search:', upd && upd.config && Object.prototype.hasOwnProperty.call(upd.config.models, 'manage_search'));
});

test('opzioni: la ricerca fra i feedback non c\'è', async ({ openTab }) => {
  const page = await openTab(OPTIONS);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const labels = await page.locator('#modelsGrid label').allTextContents();
  console.log('options grid has ricerca:', labels.some((l) => /ricerca fra i feedback/i.test(l)), labels.length);
});

test('gestione: nickname inesistente nella ricerca', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await stubManage(page);
  const inp = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-chain-input').first();
  await inp.fill('inesistentexyz');
  await inp.press('Tab');
  await page.waitForTimeout(200);
  console.log('unknown flagged', await inp.evaluate((e) => ({ color: e.style.color, title: e.title })));
});
