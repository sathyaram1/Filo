// Sonda 7 verificatore #498 — ritorno da una scheda scorsa, e il caso non-owner.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);

const geo = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
  const t = document.getElementById('mgTabs').getBoundingClientRect();
  return {
    tabsTop: Math.round(t.top), gridTop: Math.round(g.top), gridH: Math.round(g.height),
    fuori: Math.round(g.bottom) - doc.clientHeight,
    scrollTop: Math.round(doc.scrollTop),
    scroll: doc.scrollHeight - doc.clientHeight,
    viewport: doc.clientHeight,
  };
});

test('sonda7: ritorno da scheda scorsa + non-owner', async ({ app, openTab }) => {
  test.setTimeout(180000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await setSize(app, 1200, 700);
  await page.waitForTimeout(400);

  // Vado su una scheda lunga, scorro in fondo, torno ai Ricevuti.
  for (const t of ['models', 'automation', 'log', 'stats']) {
    const b = page.locator(`.mg-tab[data-tab="${t}"]`);
    if (!(await b.count()) || !(await b.isVisible())) continue;
    await b.click();
    await page.waitForTimeout(350);
    await page.evaluate(() => { document.documentElement.scrollTop = document.documentElement.scrollHeight; });
    await page.waitForTimeout(200);
    await page.locator('.mg-tab[data-tab="inbox"]').click();
    await page.waitForTimeout(400);
    console.log(`RITORNO da ${t}`, JSON.stringify(await geo(page)));
  }

  // Non-owner: com'è davvero fatta la testata?
  await page.evaluate(() => window.__mgTest.setAdmin(false));
  await page.waitForTimeout(600);
  const testata = await page.evaluate(() => ({
    banner: !document.getElementById('mgBanner').hidden,
    noSections: !document.getElementById('mgNoSections').hidden,
    testoNoSections: document.getElementById('mgNoSections').textContent.trim().slice(0, 80),
    grigliaVisibile: !!document.getElementById('mgReviewGrid').offsetParent,
  }));
  console.log('NON-OWNER testata', JSON.stringify(testata));
  for (const [w, h] of [[1280, 800], [1200, 600], [900, 560], [720, 470]]) {
    await setSize(app, w, h); await page.waitForTimeout(400);
    console.log(`NON-OWNER ${w}x${h}`, JSON.stringify(await geo(page)));
  }
  const lente = page.locator('#mgSearchToggle');
  if (await lente.isVisible()) {
    await lente.click(); await page.waitForTimeout(300);
    for (const [w, h] of [[1200, 600], [900, 560], [720, 470]]) {
      await setSize(app, w, h); await page.waitForTimeout(400);
      console.log(`NON-OWNER+RICERCA ${w}x${h}`, JSON.stringify(await geo(page)));
    }
  }
  await setSize(app, 1280, 800); await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-g3-non-owner.png' });
});
