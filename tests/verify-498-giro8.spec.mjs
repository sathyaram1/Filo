// Verifica avversariale #498 — ottavo giro: col blocco delle fusioni in attesa
// sopra le aree, cosa succede cambiando sezione, e quanto rimane visibile.

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
    blocks: [{ kind: 'protected-paths', items: ['package.json'] }],
  };
}

test('#498 fusioni in attesa: cosa resta visibile, e cosa cambia sezione per sezione', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate((reqs) => {
    window.SN_MERGE_APPROVALS.render(document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
  }, [richiesta(0), richiesta(1)]);
  await page.waitForTimeout(400);

  const suRicevuti = await page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    return {
      areeVisibili: Math.round(Math.min(g.bottom, doc.clientHeight) - Math.max(g.top, 0)),
      gridH: Math.round(g.height), viewportH: doc.clientHeight, scrollH: doc.scrollHeight,
    };
  });
  console.log('RICEVUTI con 2 fusioni', JSON.stringify(suRicevuti));

  // Le altre schede-lista condividono lo stesso pannello: il blocco si nasconde?
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await page.waitForTimeout(400);
  const suCoda = await page.evaluate(() => {
    const doc = document.documentElement;
    const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
    const m = document.getElementById('mgMergeApprovals');
    return {
      bloccoNascosto: m.hidden,
      gridH: Math.round(g.height), viewportH: doc.clientHeight, scrollH: doc.scrollHeight,
    };
  });
  console.log('IN CODA con 2 fusioni', JSON.stringify(suCoda));
  await page.screenshot({ path: 'tests/.shots/v498-fusioni-2-ricevuti.png' });
});
