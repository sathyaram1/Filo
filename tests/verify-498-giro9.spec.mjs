// Verifica avversariale #498 — controprova: le due correzioni sono davvero
// quello che tiene? Qui si rimettono a mano i valori di PRIMA (riquadro delle
// fusioni senza tetto, barra di ricerca che si tira su di 12px fissi) e si
// controlla che gli stessi assert diventino rossi. Se non diventano rossi, i
// test nuovi non stanno guardando niente.

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

test('senza il tetto sul riquadro delle fusioni le aree uscivano dallo schermo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  async function conFusioni(quante) {
    await page.evaluate((reqs) => {
      window.SN_MERGE_APPROVALS.render(
        document.getElementById('mgMergeApprovals'), { requests: reqs, failed: [] });
    }, Array.from({ length: quante }, (_, i) => richiestaFinta(i)));
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const doc = document.documentElement;
      const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
      return {
        gridH: Math.round(g.height), gridBottom: Math.round(g.bottom),
        viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      };
    });
  }

  // Com'è adesso: tre fusioni in attesa e le aree restano dentro la finestra.
  const adesso = await conFusioni(3);
  console.log('ADESSO 3 fusioni', JSON.stringify(adesso));
  expect(adesso.scrollH).toBeLessThanOrEqual(adesso.viewport + 1);
  expect(adesso.gridBottom).toBeLessThanOrEqual(adesso.viewport + 1);

  // Com'era prima: tolgo il tetto, e la stessa scena rompe gli stessi assert.
  await page.addStyleTag({ content: '#mgMergeApprovals { max-height: none !important; overflow-y: visible !important; }' });
  await page.waitForTimeout(250);
  const prima = await conFusioni(3);
  console.log('PRIMA 3 fusioni', JSON.stringify(prima));
  expect(prima.scrollH, 'senza tetto la pagina DEVE tornare a scorrere').toBeGreaterThan(prima.viewport + 1);
  expect(prima.gridBottom, 'senza tetto le aree DEVONO uscire dalla finestra').toBeGreaterThan(prima.viewport + 1);
});

test('col vecchio margine fisso la barra di ricerca tornava appiccicata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();

  const misura = () => page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const b = document.getElementById('mgSearchBar').getBoundingClientRect();
    return Math.round(b.top - t.bottom);
  });

  const adesso = await misura();
  console.log('STACCO adesso', adesso);
  expect(adesso).toBeGreaterThanOrEqual(6);

  await page.addStyleTag({ content: '#mgSearchBar { margin-top: -12px !important; }' });
  await page.waitForTimeout(200);
  const prima = await misura();
  console.log('STACCO col margine fisso di prima', prima);
  expect(prima, 'col numero ricopiato a mano lo stacco DEVE tornare quasi zero').toBeLessThan(6);
});
