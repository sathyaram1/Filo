import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('diag 563: la tendina del font resta dentro la finestra stretta', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 720, height: 800 });
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');
  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  await expect(mod.locator('.ed-font-pop')).toBeVisible();
  const m = await page.evaluate(() => {
    const pop = document.querySelector('.ed-font-pop');
    const btn = document.querySelector('.ed-font-button');
    const p = pop.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      popLeft: p.left, popRight: p.right, popW: p.width,
      btnLeft: b.left, btnRight: b.right,
      sarebbeUscita: b.left + p.width > window.innerWidth,
    };
  });
  console.log('MISURA', JSON.stringify(m));
  expect(m.popRight, 'la tendina esce dal bordo destro').toBeLessThanOrEqual(m.vw + 1);
  expect(m.popLeft).toBeGreaterThanOrEqual(0);
});
