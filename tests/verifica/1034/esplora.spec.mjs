import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const BASE = { text: 'Testo.', name: 'Prova', seq: 12, subSeq: 0, createdAt: '2026-06-22T10:00:00Z', images: [] };
const CASI = [
  ['normale', 'inbox', { ...BASE, _id: 'e-n', status: 'new', clientId: 'tester@example.com' }],
  ['spam', 'inbox', { ...BASE, _id: 'e-spam', status: 'spam', clientId: 'tester@example.com' }],
  ['file', 'inbox', { ...BASE, _id: 'e-file', status: 'suspicious_file', clientId: 'owner:abc' }],
  ['coda', 'queue', { ...BASE, _id: 'e-coda', status: 'todo', reviewDecision: 'accepted', clientId: 'tester@example.com',
    mergePreapproved: { by: 'owner@esempio.it · approvazione 0123456789abcdef01234567', at: '2026-09-13T07:30:00.000Z' } }],
];
const LARGH = [1280, 1000, 800];
for (const w of LARGH) for (const [nome, tab, fb] of CASI) for (const tema of ['light', 'dark']) {
  if (tema === 'dark' && w !== 1280) continue;
  test(`esplora ${w} ${nome} ${tema}`, async ({ openTab, app }) => {
    const page = await openTab(URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
    await page.emulateMedia({ colorScheme: tema });
    await app.evaluate(({ BrowserWindow }, w) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(w, 800); }, w);
    await page.waitForTimeout(400);
    await page.evaluate(([f, t]) => {
      window.__mgTest.setAdmin(true); window.__mgTest.setData([f]); window.__mgTest.setTab(t); window.__mgTest.openDetail(f._id);
    }, [fb, tab]);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const vis = (el) => el && !el.hidden && el.getClientRects().length > 0;
      const sc = document.querySelector('#mgOwnerBar .mg-owner-tasti');
      const sr = sc.getBoundingClientRect();
      const tasti = [...document.querySelectorAll('#mgOwnerBar .mg-owner-row button')].filter(vis).map((b) => {
        const r = b.getBoundingClientRect();
        return { t: b.textContent.trim(), c: Math.round(r.top + r.height / 2), l: Math.round(r.left), r: Math.round(r.right), fuori: r.right > sr.right + 1 };
      });
      const info = document.getElementById('mgPreapprovedInfo');
      const ir = vis(info) ? info.getBoundingClientRect() : null;
      return { win: window.innerWidth, sw: sc.scrollWidth, cw: sc.clientWidth, sh: sc.offsetHeight, ch: sc.clientHeight, tasti,
        info: ir && { l: Math.round(ir.left), t: Math.round(ir.top), w: Math.round(ir.width), h: Math.round(ir.height), txt: info.textContent } };
    });
    console.log(`${w} ${nome} ${tema}`, JSON.stringify(m));
    const bar = page.locator('#mgOwnerBar');
    await bar.screenshot({ path: `tests/.shots/1034-${w}-${nome}-${tema}.png` });
    if (w === 1280 && tema === 'light' && nome === 'normale') await page.screenshot({ path: `tests/.shots/1034-full.png` });
  });
}
