// Sonda 3 verificatore #498 — giro 3: combinazioni realistiche del proprietario
// (owner, niente banner) e catture per l'occhio.
import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function richiestaFinta(i) {
  return {
    id: `req-${i}`, branch: `claude/lavoro-numero-${i}`,
    sha: `abcdef012345678901234567890abcdef012345${i}`,
    who: `routine-${i}`, origin: 'routine', feedbackNum: `#${400 + i}`,
    createdAtMs: Date.now() - 3600_000, expiresAtMs: Date.now() + 6 * 86400_000,
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
    return {
      gridH: Math.round(g.height),
      bloccoH: Math.round(b.getBoundingClientRect().height),
      viewport: doc.clientHeight,
      fuori: Math.round(g.bottom) - doc.clientHeight,
      scroll: doc.scrollHeight - doc.clientHeight,
      sbordo: doc.scrollWidth - doc.clientWidth,
    };
  });
}
const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);
const setZoom = (app, l) => app.evaluate(async ({ webContents }, lv) => {
  for (const wc of webContents.getAllWebContents()) {
    try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(lv); } catch (_) {}
  }
}, l);

test('sonda3: owner, ricerca, fusioni — combinazioni reali', async ({ app, openTab }) => {
  test.setTimeout(240000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });

  // owner, solo la ricerca aperta (niente fusioni): quanto in basso regge?
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  for (const [w, h] of [[1366, 728], [1200, 600], [900, 560], [720, 520], [720, 470]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    console.log(`OWNER+RICERCA ${w}x${h}`, JSON.stringify(await misura(page)));
  }
  // owner, ricerca aperta + zoom, alla misura d'apertura
  await setSize(app, 1280, 800); await page.waitForTimeout(300);
  for (const z of [1, 2, 2.5, 3, 4, 5]) {
    await setZoom(app, z); await page.waitForTimeout(350);
    console.log(`OWNER+RICERCA 1280x800 zoom ${z}`, JSON.stringify(await misura(page)));
  }
  await setZoom(app, 0);
  await page.locator('#mgSearchClose').click();
  await page.waitForTimeout(300);

  // owner + fusioni + ricerca (il caso completo, che è lo stato normale)
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, [0, 1].map((i) => richiestaFinta(i)));
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(400);
  for (const [w, h] of [[1280, 800], [1366, 728], [1440, 780], [1200, 640], [1024, 600]]) {
    await setSize(app, w, h);
    await page.waitForTimeout(400);
    console.log(`OWNER+FUSIONI+RICERCA ${w}x${h}`, JSON.stringify(await misura(page)));
  }
  await setSize(app, 1280, 800); await page.waitForTimeout(300);
  for (const z of [0.5, 1, 1.5, 2, 2.5, 3]) {
    await setZoom(app, z); await page.waitForTimeout(350);
    console.log(`OWNER+FUSIONI+RICERCA 1280x800 zoom ${z}`, JSON.stringify(await misura(page)));
  }
  await setZoom(app, 0);
  await page.waitForTimeout(300);

  // Catture: il riquadro schiacciato al minimo — si capisce che sotto c'è altro?
  await page.locator('#mgSearchClose').click();
  await setSize(app, 1366, 728);
  await setZoom(app, 2.5);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v498-g3-riquadro-al-minimo.png' });
  console.log('CATTURA minimo', JSON.stringify(await misura(page)));
  await setZoom(app, 0); await setSize(app, 1280, 800); await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-g3-normale.png' });
});
