import { test, expect } from '../../fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
test('diag', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const auth = globalThis.__filoAuth;
    auth.isAdmin = () => true;
    auth.getIdToken = async () => 'tok';
    globalThis.__avvii = [];
    globalThis.__letture = [];
    const FB = globalThis.SN_FEEDBACK;
    globalThis.__docs = [{ _id: 'x1', _updateTime: 't1', updatedAt: '2026-09-01T10:00:00.000Z', name: 'X', seq: 1, subSeq: 0, createdAt: '2026-09-01T10:00:00Z', images: [], text: 'x' }];
    FB.listVersions = async () => { globalThis.__letture.push('VERS'); return globalThis.__docs.map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt })); };
    FB.listChangedSince = async () => ({ rows: [], complete: true });
    FB.getManyPublic = async () => [];
    FB.versionsOf = async () => [];
    FB.getMany = async () => [];
    FB.submissionCount = async () => 2;
    globalThis.__filoDefaults.getWorkerLog = async () => { globalThis.__letture.push(`LOG:${JSON.stringify(globalThis.__avvii)}`); return globalThis.__avvii; };
    globalThis.SN_FEEDBACK_LIVE.POLL_MS = 200;
  });
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); window.__mgTest.resumeLive(); });
  await page.evaluate(async () => {
    await window.filo.message({ type: 'feedback_live_subscribe', off: true });
    await window.filo.message({ type: 'feedback_live_subscribe', watch: [] });
  });
  await new Promise((r) => setTimeout(r, 700));
  for (let k = 1; k <= 3; k += 1) {
    await app.evaluate((i) => { globalThis.__avvii = [{ role: 'r', startedAt: `2026-09-24T10:0${i}:00Z`, num: `#${i}` }]; }, k);
    await new Promise((r) => setTimeout(r, 700));
  }
  console.log('LETTURE', JSON.stringify(await app.evaluate(() => globalThis.__letture), null, 0));
});
