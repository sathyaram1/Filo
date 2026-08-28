// TEMPORANEO — gemella dei feedback CON i numeri, a finestra stretta.
import { test } from './fixtures/electron.mjs';

test('gemella 720 con numeri', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 820);
  });
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.evaluate(() => {
    const st = ['new', 'agent', 'draft', 'todo', 'review', 'blocked', 'clarify', 'done', 'verified'];
    const items = [];
    let n = 0;
    st.forEach((s, i) => {
      for (let k = 0; k <= i * 3 + 11; k++) {
        items.push({ _id: `x${n}`, seq: ++n, subSeq: 0, name: `t${n}`, text: `t${n}`, status: s, createdAt: '2026-06-20T10:00:00Z', images: [] });
      }
    });
    SN_FEEDBACK.list = async () => items;
  });
  await page.reload();
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 720, height: 820 });
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const out = [];
    for (const btn of document.querySelectorAll('.fb-tab')) {
      const range = document.createRange();
      range.selectNodeContents(btn);
      const tops = [...range.getClientRects()].map((r) => Math.round(r.top));
      out.push({ txt: btn.textContent, righe: new Set(tops).size });
    }
    return { out, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
  });
  console.log(JSON.stringify(res));
});
