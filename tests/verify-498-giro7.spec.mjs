// Verifica avversariale #498 — settimo giro: la porta rimasta.
// Le tre aree ora prendono "quello che avanza" sotto le schede. Ma dentro la
// stessa colonna, SOPRA di loro, vive il blocco delle fusioni fermate in attesa
// del via libera dell'owner — e quel blocco non ha né tetto né scorrimento
// proprio. Se le fusioni in attesa sono più d'una, quanto resta alle aree?

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function richiesta(i) {
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
    const m = document.getElementById('mgMergeApprovals').getBoundingClientRect();
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    return {
      tabsTop: Math.round(t.top),
      bloccoH: Math.round(m.height),
      gridTop: Math.round(g.top),
      gridH: Math.round(g.height),
      gridBottom: Math.round(g.bottom),
      viewportH: doc.clientHeight,
      scrollH: doc.scrollHeight,
    };
  });
}

test('#498 fusioni in attesa sopra le aree: quanto resta alle aree', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  const disponibile = await page.evaluate(() => !!window.SN_MERGE_APPROVALS);
  console.log('modulo fusioni disponibile:', disponibile);

  for (const n of [0, 1, 2, 3, 5]) {
    await page.evaluate((reqs) => {
      const host = document.getElementById('mgMergeApprovals');
      window.SN_MERGE_APPROVALS.render(host, { requests: reqs, failed: [] });
    }, Array.from({ length: n }, (_, i) => richiesta(i)));
    await page.waitForTimeout(350);
    const m = await misura(page);
    console.log(`FUSIONI ${n}`, JSON.stringify(m));
    if (n === 3) await page.screenshot({ path: 'tests/.shots/v498-fusioni-3.png' });
    if (n === 5) await page.screenshot({ path: 'tests/.shots/v498-fusioni-5.png' });
  }
});
