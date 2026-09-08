// Sonda 4 verificatore #498 — le schede spariscono con lo zoom?
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);
const setZoom = (app, l) => app.evaluate(async ({ webContents }, lv) => {
  for (const wc of webContents.getAllWebContents()) {
    try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(lv); } catch (_) {}
  }
}, l);

test('sonda4: schede visibili a ogni zoom e larghezza', async ({ app, openTab }) => {
  test.setTimeout(180000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });

  const elenco = () => page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('#mgTabs .mg-tab')) {
      const r = t.getBoundingClientRect();
      out.push({
        tab: t.dataset.tab, hidden: t.hidden,
        w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y),
        visibile: r.width > 0 && r.height > 0,
      });
    }
    const nav = document.getElementById('mgTabs').getBoundingClientRect();
    return { nav: { w: Math.round(nav.width), h: Math.round(nav.height) }, tabs: out,
      clientW: document.documentElement.clientWidth };
  });

  for (const [w, h, z] of [[1280, 800, 0], [1366, 728, 2.5], [1366, 728, 3], [1280, 800, 5], [720, 700, 0]]) {
    await setSize(app, w, h); await setZoom(app, z);
    await page.waitForTimeout(500);
    const e = await elenco();
    console.log(`TABS ${w}x${h} zoom ${z}`, JSON.stringify(e));
    const fuori = e.tabs.filter((t) => !t.hidden && (t.x + t.w > e.clientW + 1));
    if (fuori.length) console.log('  >>> SCHEDE TAGLIATE A DESTRA:', JSON.stringify(fuori));
  }
  await setZoom(app, 0);
});
