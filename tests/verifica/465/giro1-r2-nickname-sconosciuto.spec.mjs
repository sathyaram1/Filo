// Verifica #465, giro 1, rilievo 2: nel posto nuovo il campo della ricerca fra i feedback
// deve segnalare un nickname che non esiste, come faceva nelle Opzioni e in Modelli predefiniti.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';

test('un nickname che non esiste, nel campo della ricerca fra i feedback, si segnala', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    const models = {
      sanitizer: 'flash', judge1: 'giudice-veloce', judge2: '', judge3: '', judgeDynamic: '',
      judgeRedTeam: '', judgePriority: '', manageSearch: 'flash',
      judgeRegistry: { 'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' } },
      sharedNicknames: [{ nick: 'flash', label: '' }],
      openrouterKeyPresent: true,
    };
    window.filo.message = async (msg) => {
      if (msg.type === 'support_models_get') return { ok: true, models: JSON.parse(JSON.stringify(models)) };
      if (msg.type === 'default_models_list') return { ok: true, provider: 'openrouter', items: [] };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
  });
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible();

  const inp = page.locator('.mg-sm-slot[data-slot="manageSearch"] .sn-chain-input').first();
  await expect(inp).toHaveValue('flash');
  await inp.fill('flsh');
  await inp.press('Tab');
  // Stesso segnale delle Opzioni: il campo si colora e l'hover dice perché.
  await expect.poll(() => inp.evaluate((e) => Boolean(e.title) || Boolean(e.style.color))).toBe(true);
});
