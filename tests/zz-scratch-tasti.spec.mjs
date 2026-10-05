import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
const base = { text: 'Testo della segnalazione.', clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [], subSeq: 0 };
const casi = [
  ['inbox', { ...base, _id: 'a', name: 'Nuovo', seq: 1, status: 'new' }],
  ['queue', { ...base, _id: 'b', name: 'In coda', seq: 2, status: 'todo', reviewDecision: 'accepted' }],
  ['queue', { ...base, _id: 'c', name: 'In coda col segno', seq: 3, status: 'todo', reviewDecision: 'accepted', mergePreapproved: { by: 'owner@esempio', at: '2026-09-13T07:30:00.000Z' } }],
];
for (const [tab, fb] of casi) {
  test(`shot ${fb._id}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => {
      const orig = window.filo.message.bind(window.filo);
      window.filo.message = async (m) => (m && m.type === 'auth_status') ? { ok: true, signedIn: true, isAdmin: true } : orig(m);
    });
    await page.evaluate(([t, f]) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([f]); window.__mgTest.setTab(t); window.__mgTest.openDetail(f._id); }, [tab, fb]);
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('#mgOwnerBar button')].filter((b) => b.offsetParent);
      return { w: document.getElementById('mgDetailCol').clientWidth, vw: innerWidth, btns: vis.map((b) => [b.id || b.dataset.actionKey, b.textContent, Math.round(b.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().width)]) };
    });
    console.log(fb._id, JSON.stringify(info));
    await page.screenshot({ path: `tests/.shots/tasti-prima-${fb._id}.png` });
  });
}
