// Sonda 2 (#498): la vista dell'OWNER (nessun banner) alla misura di finestra
// predefinita di Filo, con e senza la barra di ricerca aperta.
import { test } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function setSize(app, w, h) {
  await app.evaluate(async ({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setContentSize(w, h);
  }, [w, h]);
  await new Promise((r) => setTimeout(r, 400));
}

function req(i) {
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
    const grid = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const blocco = document.getElementById('mgMergeApprovals');
    return {
      gridTop: Math.round(grid.top), gridH: Math.round(grid.height),
      gridBottom: Math.round(grid.bottom),
      bloccoH: Math.round(blocco.getBoundingClientRect().height),
      viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      fuori: Math.round(grid.bottom - doc.clientHeight),
    };
  });
}

test('sonda owner: finestra predefinita, ricerca aperta, fusioni', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  for (const [w, h] of [[1280, 840], [1366, 768], [1280, 800]]) {
    await setSize(app, w, h);
    for (const ricerca of [false, true]) {
      const aperta = await page.locator('#mgSearchBar').isVisible();
      if (aperta !== ricerca) await page.locator('#mgSearchToggle').click();
      await page.waitForTimeout(200);
      for (const n of [0, 1, 2, 5]) {
        await page.evaluate((reqs) => {
          window.SN_MERGE_APPROVALS.render(
            document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
        }, Array.from({ length: n }, (_, i) => req(i)));
        await page.waitForTimeout(220);
        const m = await misura(page);
        console.log(`OWNER ${w}x${h} ricerca=${ricerca} fusioni=${n} ${JSON.stringify(m)}`);
      }
    }
  }

  // Traccia visiva del caso peggiore realistico.
  await setSize(app, 1366, 768);
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(
      document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, Array.from({ length: 2 }, (_, i) => req(i)));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v498-owner-1366x768.png' });
});
