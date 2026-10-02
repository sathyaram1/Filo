import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

async function apri(page, extra = {}) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate((extra) => {
    const orig = window.filo.message.bind(window.filo);
    const models = {
      sanitizer: 'flash', judge1: 'giudice-veloce', judge2: '', judge3: '', judgeDynamic: '',
      judgeRedTeam: '', judgePriority: '', manageSearch: 'flash',
      judgeRegistry: { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } },
      sharedNicknames: [{ nick: 'flash', label: 'DeepSeek Flash' }, { nick: 'kimi', label: '' }],
      appRegistry: { flash: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', label: 'DeepSeek Flash' }, kimi: { provider: 'openrouter', model: 'moonshotai/kimi-k2.6' } },
      openrouterKeyPresent: true,
      ...extra.models,
    };
    window.__sent = [];
    window.filo.message = async (msg) => {
      if (msg.type === 'support_models_get') return { ok: true, models: JSON.parse(JSON.stringify(models)) };
      if (msg.type === 'default_models_list') {
        if (extra.catalogFail) return { ok: false, error: 'offline' };
        return { ok: true, provider: 'openrouter', items: [{ id: 'moonshotai/kimi-k2.6', label: 'Multimodale' }, { id: 'deepseek/deepseek-v4-flash', label: 'Testo' }] };
      }
      if (msg.type === 'support_models_update') {
        window.__sent.push(JSON.parse(JSON.stringify(msg)));
        return { ok: true, models: { ...models, ...msg.models, judgeRegistry: msg.judgeRegistry } };
      }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  }, extra);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible();
}

test('giudici: suggerimenti mentre scrivi', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const inp = page.locator('.mg-sm-slot[data-slot="judge2"] .sn-chain-input').first();
  await inp.click();
  await inp.pressSequentially('f');
  const pop = page.locator('.mg-sm-slot[data-slot="judge2"] .sn-select-pop');
  await expect(pop).toBeVisible();
  console.log('judge2 opts', await pop.locator('.sn-select-option').evaluateAll((e) => e.map((x) => x.dataset.value)));
  await page.screenshot({ path: 'tests/.shots/465v2-giudice.png' });
});

test('ricerca: suggerimenti e screenshot chiaro/scuro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const inp = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-chain-input').first();
  await inp.scrollIntoViewIfNeeded();
  await inp.click();
  await inp.fill('');
  await inp.pressSequentially('k');
  const pop = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-select-pop');
  await expect(pop).toBeVisible();
  console.log('search opts', await pop.locator('.sn-select-option').evaluateAll((e) => e.map((x) => x.dataset.value)));
  await page.screenshot({ path: 'tests/.shots/465v2-ricerca-chiaro.png' });
  await page.evaluate(() => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/465v2-ricerca-scuro.png' });
});

test('catalogo che non arriva: il campo resta libero e propone gli id già scritti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, { catalogFail: true });
  await page.click('#mgSmRegistryAdd');
  const riga = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  const campo = riga.locator('.sn-model-id');
  await campo.click();
  await campo.pressSequentially('deep');
  const pop = riga.locator('.sn-select-pop');
  console.log('fail visible', await pop.isVisible());
  if (await pop.isVisible()) console.log('fail opts', await pop.locator('.sn-select-option').evaluateAll((e) => e.map((x) => x.dataset.value)));
  await campo.fill('<img src=x onerror=alert(1)>');
  await campo.press('Tab');
  await page.click('#mgSmSaveBtn');
  await page.waitForTimeout(500);
  console.log('status', await page.locator('#mgSmStatus').textContent());
});

test('admin-defaults e Opzioni: la ricerca non compare', async ({ openTab }) => {
  const page = await openTab('filo://admin-defaults/admin-defaults.html');
  await page.waitForLoadState('domcontentloaded');
  const body = await page.evaluate(() => document.body.innerText);
  console.log('admin has ricerca', /ricerca fra i feedback/i.test(body));
  const opt = await openTab('filo://options/options.html');
  await opt.waitForLoadState('domcontentloaded');
  await opt.waitForTimeout(1500);
  const html = await opt.evaluate(() => document.body.innerText);
  console.log('options has ricerca', /ricerca fra i feedback/i.test(html));
});
