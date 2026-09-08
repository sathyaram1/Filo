// Sonda 6 verificatore #498 — tema scuro vero e la cattura dello stato rotto.
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
const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);
const setZoom = (app, l) => app.evaluate(async ({ webContents }, lv) => {
  for (const wc of webContents.getAllWebContents()) {
    try { if ((wc.getURL() || '').includes('manage.html')) wc.setZoomLevel(lv); } catch (_) {}
  }
}, l);

test('sonda6: scuro + stato rotto', async ({ app, openTab }) => {
  test.setTimeout(180000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, [0, 1].map((i) => richiestaFinta(i)));
  await page.waitForTimeout(300);

  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v498-g3-scuro-vero.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'light'));
  await page.waitForTimeout(300);

  // Lo stato rotto: ricerca aperta + due fusioni + zoom 144% (4 tocchi di Ctrl+)
  await page.locator('#mgSearchToggle').click();
  await page.waitForTimeout(300);
  await setSize(app, 1280, 800);
  for (const z of [2, 2.5, 3]) {
    await setZoom(app, z);
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
      return {
        gridH: Math.round(g.height),
        fuori: Math.round(g.bottom) - doc.clientHeight,
        scroll: doc.scrollHeight - doc.clientHeight,
        viewport: doc.clientHeight,
      };
    });
    console.log(`ROTTO zoom ${z}`, JSON.stringify(m));
    await page.screenshot({ path: `tests/.shots/v498-g3-rotto-zoom${z}.png` });
    // scorrendo in fondo si vede la fine delle aree?
    await page.evaluate(() => { document.documentElement.scrollTop = document.documentElement.scrollHeight; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `tests/.shots/v498-g3-rotto-zoom${z}-infondo.png` });
    await page.evaluate(() => { document.documentElement.scrollTop = 0; });
  }
  await setZoom(app, 0);
});
