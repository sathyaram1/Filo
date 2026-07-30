import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://redteam/redteam.html';
test('DEBUG dom', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    window.RedteamUI.applyState({
      signedIn: true, verified: true, isOwner: false, gridUnlocked: {}, milestones: {},
      recentAttempts: [{ id:'d1', title:'T', attackText:'x', description:'d',
        verdicts:{A:{class:'pass',points:3,reasoning:'r'}}, score:6,isValidAttack:true,
        validityReasoning:'ok',status:'complete',createdAt:Date.now()-3600000 }],
    });
  });
  await page.locator('#historyBody .rt-hist-row').first().click();
  const m = await page.evaluate(() => {
    const detailTr = document.querySelector('#historyBody .rt-hist-detail');
    const td = detailTr.querySelector('td');
    return { colSpan: td.colSpan, attr: td.getAttribute('colspan'),
      cellsInDataRow: document.querySelectorAll('#historyBody .rt-hist-row > td').length,
      display_detail: getComputedStyle(detailTr.querySelector('.rt-detail')).display,
      tdDisplay: getComputedStyle(td).display,
      trHTML: detailTr.outerHTML.slice(0,200) };
  });
  console.log('DOM', JSON.stringify(m));
});
