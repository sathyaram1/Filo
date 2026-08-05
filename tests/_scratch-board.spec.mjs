import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://board/board.html';
const SHIPPED = { _id:'fb-x', name:'Fix comparso dopo il retry', status:'done', resolvedInVersion:'0.2.70', seq:77, subSeq:0, clientId:'t@e.com', createdAt:'2026-06-20T10:00:00Z', votes:{} };

test('diag', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW && window.SN_CHAT_ERRORS, null, { timeout: 15000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20000 });

  await page.evaluate(() => { window.__boardTest.setReleasedVersion('0.2.71'); window.SN_FEEDBACK.list = () => Promise.reject(new TypeError('Failed to fetch')); });
  await page.evaluate(() => window.__boardTest.reload());
  await expect(page.locator('#bdError')).toBeVisible();

  const diag = await page.evaluate(async (shipped) => {
    window.SN_FEEDBACK.list = () => Promise.resolve([shipped]);
    let direct = null, directErr = null;
    try { direct = await window.SN_FEEDBACK.list({ pageSize: 500, timeoutMs: 8000 }); }
    catch (e) { directErr = String(e); }
    await window.__boardTest.reload();
    const MR = window.SN_MANAGE_REVIEW;
    return {
      directLen: Array.isArray(direct) ? direct.length : null,
      directErr,
      errMsg: document.getElementById('bdErrorMsg').textContent,
      cards: document.querySelectorAll('.bd-card').length,
      listHidden: document.getElementById('bdList').hidden,
      errHidden: document.getElementById('bdError').hidden,
      emptyHidden: document.getElementById('bdEmpty').hidden,
      boardTabCount: MR.listBoardTab([shipped], { releasedVersion: '0.2.71' }).length,
    };
  }, SHIPPED);
  console.log('DIAG:', JSON.stringify(diag));
});
