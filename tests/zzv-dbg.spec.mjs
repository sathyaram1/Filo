import { test } from './fixtures/electron.mjs';

test('dbg', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ _id: 'fb-b', name: 'Beta', text: 't', seq: 901, subSeq: 0, status: 'done', clientId: 'x@y.z', createdAt: '2026-06-02T10:00:00Z', images: [], userNote: 'W0' }]);
  });
  console.log('DBG after setData', await page.evaluate(() => ({
    un: document.getElementById('mgUserNote').hidden,
  })));
  await page.evaluate(() => window.__mgTest.setTab('done'));
  await page.evaluate(() => window.__mgTest.openDetail('fb-b'));
  console.log('DBG after open', await page.evaluate(() => ({
    unHidden: document.getElementById('mgUserNote').hidden,
    detailHidden: document.getElementById('mgDetail').hidden,
    val: document.getElementById('mgUserNoteText').value,
    banner: document.getElementById('mgBanner').hidden,
  })));
});
