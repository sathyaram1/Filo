import { test, expect } from './fixtures/electron.mjs';

test('diag 563: rects delle schede di gestione a 720px', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });
  const page = await openTab('filo://manage/');
  await page.locator('#mgTabs').waitFor({ state: 'visible', timeout: 8000 });
  await page.setViewportSize({ width: 720, height: 800 });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const out = [];
    for (const btn of document.querySelectorAll('.mg-tab')) {
      if (btn.hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(btn);
      const rects = [...range.getClientRects()].map((r) => ({
        top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height,
      }));
      out.push({ txt: btn.textContent, dpr: window.devicePixelRatio, rects });
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  expect(true).toBe(true);
});
