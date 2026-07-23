import { test } from './fixtures/electron.mjs';
import fs from 'node:fs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
test('screenshot pannello appunti', async ({ app, shell }) => {
  await shell.locator('.tab').first().waitFor({ timeout: 8000 });
  const page = await newtabPage(app);
  await page.evaluate(() => new Promise((res) => {
    const M = window.SN_MSG.MSG;
    chrome.runtime.sendMessage({ type: M.FILO_ADD_NOTE, text: 'Domani riunione alle 10 con il team', context: 'chat home' }, () =>
      chrome.runtime.sendMessage({ type: M.FILO_ADD_NOTE, text: 'Comprare il latte 🥛 tornando a casa', context: '' }, () => res()));
  }));
  await page.locator('.dash-ctrl[data-command="notes"]').click();
  await page.locator('.dash-notes-box').waitFor();
  await page.waitForTimeout(400);
  fs.mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/notes-panel.png' });
});
