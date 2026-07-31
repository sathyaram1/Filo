import { test, expect } from './fixtures/electron.mjs';

const PAGES = [
  'filo://editor/editor.html',
  'filo://archive/archive.html',
  'filo://history/history.html',
  'filo://credits/credits.html',
  'filo://redteam/redteam.html',
  'filo://spellcheck/spellcheck.html',
  'filo://home/home.html',
];

test('click su ogni bottone visibile', async ({ openTab }) => {
  test.setTimeout(300000);
  for (const url of PAGES) {
    const page = await openTab(url);
    await page.waitForTimeout(1200);
    const n = await page.evaluate(() => document.querySelectorAll('button:not([disabled])').length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const errs = [];
      const onErr = (e) => errs.push(String(e).slice(0, 200));
      page.on('pageerror', onErr);
      const info = await page.evaluate((idx) => {
        const b = document.querySelectorAll('button:not([disabled])')[idx];
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { label: (b.textContent || b.title || b.id || '').trim().slice(0, 40), id: b.id, visible: r.width > 0 && r.height > 0 };
      }, i);
      if (!info || !info.visible) { page.off('pageerror', onErr); continue; }
      await page.evaluate((idx) => {
        const b = document.querySelectorAll('button:not([disabled])')[idx];
        if (b) b.click();
      }, i).catch(() => {});
      await page.waitForTimeout(300);
      page.off('pageerror', onErr);
      if (errs.length) out.push({ btn: info, errs });
    }
    console.log(`### ${url} buttons=${n} problemi=${JSON.stringify(out)}`);
  }
});
