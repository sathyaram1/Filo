import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

test('shot notes panel', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const notes = [
    ['Domani riunione alle 10 con il team di design', 'chat del 12/6'],
    ['Comprare regalo di compleanno per Marco', ''],
    ['Idea: aggiungere una modalità focus che silenzia le notifiche', 'brainstorming'],
  ];
  for (const [t, c] of notes) {
    await page.evaluate(([tt, cc]) => new Promise((res) => {
      chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.FILO_ADD_NOTE, text: tt, context: cc }, res);
    }), [t, c]);
  }
  await page.locator('.dash-ctrl[data-command="notes"]').click();
  await expect(page.locator('.dash-notes-box')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/notes-panel.png' });
});
