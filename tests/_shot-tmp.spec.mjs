import { test } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
const FBS = [
  { _id: 'a', name: 'Dividi le sezioni per owner', text: 'Raggruppa le sezioni owner in un\'unica icona con sotto voci.', seq: 300, subSeq: 0, status: 'archived', clientId: 't@e.com', createdAt: '2026-06-01T10:00:00Z', images: [] },
  { _id: 'b', name: 'Schede con audio', text: 'Migliorare le schede audio.', seq: 301, subSeq: 0, status: 'done', clientId: 't@e.com', createdAt: '2026-06-02T10:00:00Z', images: [] },
];
test('shot', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => { window.filo.message = async (m) => (m && m.type === 'ai_request') ? { ok: true, text: JSON.stringify([{ id: 'a', reason: 'parla di raggruppare le sezioni owner' }]) } : { ok: false }; });
  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, FBS);
  await page.screenshot({ path: 'tests/.shots/manage-tabbar.png' });
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('quando chiedevo di unire le voci in una icona');
  await page.locator('#mgSearchInput').press('Enter');
  await page.locator('.mg-item').first().waitFor();
  await page.screenshot({ path: 'tests/.shots/manage-search-results.png' });
});
