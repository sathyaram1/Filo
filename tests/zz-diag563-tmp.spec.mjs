import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status) {
  return {
    _id: id, text: `Feedback ${id}`, name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1, subSeq: 0,
    clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z',
    images: [], status,
  };
}

test('diag 563: rects delle schede di gestione a 720px', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.setViewportSize({ width: 720, height: 800 });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('q1', 'todo'), fb('r1', 'done'), fb('z1', 'archived'),
  ]);
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => {
    const out = [];
    for (const btn of document.querySelectorAll('.mg-tab')) {
      if (btn.hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(btn);
      const rects = [...range.getClientRects()].map((r) => ({
        top: +r.top.toFixed(3), bottom: +r.bottom.toFixed(3), left: +r.left.toFixed(3),
        w: +r.width.toFixed(3), h: +r.height.toFixed(3),
      }));
      const figli = [...btn.childNodes].map((n) => ({
        tipo: n.nodeType, nome: n.nodeName,
        cls: n.nodeType === 1 ? n.className : '',
        fs: n.nodeType === 1 ? getComputedStyle(n).fontSize : '',
        txt: (n.textContent || '').slice(0, 20),
      }));
      out.push({ txt: btn.textContent, dpr: window.devicePixelRatio, rects, figli });
    }
    return out;
  });
  console.log(JSON.stringify(info.slice(0, 3), null, 1));
  expect(true).toBe(true);
});
