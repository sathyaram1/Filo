import { test } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
const M = {
  sanitizer: 'flash-lite-3-or', judge1: 'giudice-veloce', judge2: 'giudice-veloce',
  judge3: 'giudice-forte', judgeDynamic: 'giudice-forte', judgeRedTeam: '', judgePriority: '',
  judgeRegistry: {
    'giudice-veloce': { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', label: 'Veloce' },
    'giudice-forte': { provider: 'openrouter', model: 'anthropic/claude-haiku-4-5' },
  },
  openrouterKeyPresent: true,
};
test('shot', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderSupportModelsEditor);
  await page.evaluate(() => window.__mgTest.setTab('models'));
  await page.evaluate((m) => window.__mgTest.renderSupportModelsEditor(m), M);
  await page.locator('#mgSmEditor').waitFor({ state: 'visible' });
  await page.screenshot({ path: process.env.SHOT_OUT, fullPage: true });
});
