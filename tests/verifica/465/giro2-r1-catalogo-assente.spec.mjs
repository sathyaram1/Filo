// Verifica #465, giro 2, rilievo 1: col catalogo OpenRouter che non arriva, il campo «Modello
// OpenRouter» del registro propone come suggerimento il testo che si sta scrivendo.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

test('senza catalogo il campo non propone il testo che si sta scrivendo', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    const models = {
      sanitizer: '', judge1: 'giudice-veloce', judge2: '', judge3: '', judgeDynamic: '',
      judgeRedTeam: '', judgePriority: '', manageSearch: '',
      judgeRegistry: { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } },
      sharedNicknames: [], appRegistry: {}, openrouterKeyPresent: true,
    };
    window.filo.message = async (msg) => {
      if (msg.type === 'support_models_get') return { ok: true, models: JSON.parse(JSON.stringify(models)) };
      if (msg.type === 'default_models_list') return { ok: false, error: 'offline' };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  });
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible();

  await page.click('#mgSmRegistryAdd');
  const riga = page.locator('#mgSmRegistryList .sn-model-row:not(.sn-model-row-head)').last();
  const campo = riga.locator('.sn-model-id');
  await campo.click();
  await campo.pressSequentially('deep');
  const pop = riga.locator('.sn-select-pop');
  await expect(pop).toBeVisible();
  const proposti = await pop.locator('.sn-select-option').evaluateAll((e) => e.map((x) => x.dataset.value));
  expect(proposti).toContain('deepseek/deepseek-v4-pro');
  expect(proposti).not.toContain('deep');
});
