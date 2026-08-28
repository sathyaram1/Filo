// TEMPORANEO — controlla la pagina gemella dei feedback a finestra stretta,
// ora che anche le sue schede portano un numero.
import { test } from './fixtures/electron.mjs';

test('gemella 720', async ({ app, openTab }) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 820);
  });
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined');
  await page.setViewportSize({ width: 720, height: 820 });
  await page.waitForTimeout(1500);
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
  await page.screenshot({ path: 'tests/.shots/feedback-tabs-720.png' });
});
