// Verifica avversariale #498 — sesto giro: dettaglio ravvicinato dello stacco
// fra la barra delle sezioni e la barra di ricerca, dopo che la barra delle
// sezioni è stata spostata in alto.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

test('#498 stacco fra barra delle sezioni e barra di ricerca', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await page.waitForTimeout(300);

  const m = await page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const s = document.getElementById('mgSearchBar').getBoundingClientRect();
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return {
      tabsBottom: t.bottom, searchTop: s.top, searchBottom: s.bottom, gridTop: g.top,
      staccoSopra: Math.round(s.top - t.bottom),
      staccoSotto: Math.round(g.top - s.bottom),
    };
  });
  console.log('STACCHI', JSON.stringify(m));
  await page.screenshot({ path: 'tests/.shots/v498-stacco.png', clip: { x: 0, y: 0, width: 700, height: 200 } });

  // Senza ricerca aperta: stacco fra schede e aree.
  await page.locator('#mgSearchClose').click();
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return { staccoSchedeAree: Math.round(g.top - t.bottom) };
  });
  console.log('SENZA RICERCA', JSON.stringify(m2));
  await page.screenshot({ path: 'tests/.shots/v498-stacco-senza.png', clip: { x: 0, y: 0, width: 700, height: 200 } });
});
