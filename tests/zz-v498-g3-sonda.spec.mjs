// Sonda verificatore #498 — giro 3. Non è un test di consegna: misura e basta.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function richiestaFinta(i) {
  return {
    id: `req-${i}`,
    branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`,
    origin: 'routine',
    feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000,
    expiresAtMs: Date.now() + 6 * 86400_000,
    blocks: [
      { kind: 'protected-paths', items: ['src/main/main.js', 'package.json'] },
      { kind: 'workflow', items: ['.github/workflows/release.yml'] },
    ],
  };
}

async function misura(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const b = document.getElementById('mgMergeApprovals');
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    return {
      tabsTop: Math.round(t.top), tabsH: Math.round(t.height),
      gridH: Math.round(g.height), gridTop: Math.round(g.top), gridBottom: Math.round(g.bottom),
      bloccoH: Math.round(b.getBoundingClientRect().height),
      bloccoScrollH: b.scrollHeight,
      viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      scrollW: doc.scrollWidth, clientW: doc.clientWidth,
    };
  });
}

async function prepara(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
}

async function fusioni(page, n) {
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, Array.from({ length: n }, (_, i) => richiestaFinta(i)));
  await page.waitForTimeout(250);
}

async function setZoom(app, l) {
  await app.evaluate(async ({ webContents }, lv) => {
    for (const wc of webContents.getAllWebContents()) {
      try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(lv); } catch (_) {}
    }
  }, l);
}

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w2, h2]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w2, h2);
  }, [w, h]);
}

test('sonda: zoom oltre +3, finestre basse, schede a capo', async ({ app, openTab }) => {
  test.setTimeout(240000);
  const page = await openTab(URL);
  await prepara(page);

  console.log('BASE senza fusioni', JSON.stringify(await misura(page)));

  await fusioni(page, 2);
  console.log('BASE 2 fusioni', JSON.stringify(await misura(page)));

  // a) zoom alto (Filo permette parecchie tacche di Ctrl e il più)
  for (const lvl of [3, 4, 5, 6, 7]) {
    await setZoom(app, lvl);
    await page.waitForTimeout(400);
    const g = await misura(page);
    console.log(`ZOOM ${lvl}`, JSON.stringify(g),
      'FUORI=', g.gridBottom - g.viewport, 'SCROLL=', g.scrollH - g.viewport);
  }
  await setZoom(app, 0);
  await page.waitForTimeout(300);

  // b) finestre basse, senza ricerca
  for (const [w, h] of [[1200, 600], [1200, 560], [1200, 520], [1200, 480], [1200, 420]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    const g = await misura(page);
    console.log(`SIZE ${w}x${h}`, JSON.stringify(g),
      'FUORI=', g.gridBottom - g.viewport, 'SCROLL=', g.scrollH - g.viewport);
  }

  // c) finestre basse CON ricerca aperta
  await setSize(app, 1200, 800);
  await page.waitForTimeout(300);
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  for (const [w, h] of [[1366, 768], [1200, 700], [1200, 620], [1200, 560], [1200, 520]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    const g = await misura(page);
    console.log(`RICERCA ${w}x${h}`, JSON.stringify(g),
      'FUORI=', g.gridBottom - g.viewport, 'SCROLL=', g.scrollH - g.viewport);
  }

  // d) finestra STRETTA: le schede vanno a capo e rubano altezza
  for (const [w, h] of [[900, 700], [700, 700], [560, 700], [420, 700], [560, 600], [420, 560]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    const g = await misura(page);
    console.log(`STRETTA ${w}x${h}`, JSON.stringify(g),
      'FUORI=', g.gridBottom - g.viewport, 'SCROLL=', g.scrollH - g.viewport,
      'SBORDO=', g.scrollW - g.clientW);
  }

  // e) stretta + zoom
  await setSize(app, 1366, 768);
  await page.waitForTimeout(300);
  for (const lvl of [1, 2, 3, 4]) {
    await setZoom(app, lvl);
    await page.waitForTimeout(400);
    const g = await misura(page);
    console.log(`1366x768 + ricerca + ZOOM ${lvl}`, JSON.stringify(g),
      'FUORI=', g.gridBottom - g.viewport, 'SCROLL=', g.scrollH - g.viewport);
  }
  await setZoom(app, 0);
});
