// Verifica avversariale #498 — quinto giro: traccia visiva delle ALTRE schede
// della dashboard, per vedere se «espandi le aree» resta scoperto altrove.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('#498 traccia visiva delle altre schede', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  for (const tab of ['stats', 'models', 'automation', 'log']) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `tests/.shots/v498-tab-${tab}.png` });
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const p = document.querySelector('.mg-panel--active');
      const b = p.getBoundingClientRect();
      return { id: p.id, bottom: Math.round(b.bottom), viewportH: doc.clientHeight, scrollH: doc.scrollHeight };
    });
    console.log('TAB', tab, JSON.stringify(info));
  }
});
