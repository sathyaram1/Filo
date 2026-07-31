// TEMPORANEO — audit prober: perché la bacheca resta su "Caricamento…".
import { test, expect } from './fixtures/electron.mjs';

test('board: diagnosi caricamento', async ({ openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://board/board.html');
  page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.waitForTimeout(15000);
  const r = await page.evaluate(async () => {
    const t0 = Date.now();
    let recap = 'PENDING';
    const p = new Promise((res) => {
      chrome.runtime.sendMessage({ type: 'get_update_recap' }, (out) => res(out));
    });
    const timed = await Promise.race([p.then((v) => ({ v })), new Promise((r2) => setTimeout(() => r2({ timeout: true }), 6000))]);
    recap = JSON.stringify(timed).slice(0, 200);
    let listErr = 'n/d';
    const t1 = Date.now();
    try {
      const l = await window.SN_FEEDBACK.list({ pageSize: 5 });
      listErr = 'ok, n=' + l.length;
    } catch (e) { listErr = 'THROW ' + String(e).slice(0, 120); }
    return { recap, recapMs: Date.now() - t0, listErr, listMs: Date.now() - t1,
      loading: !document.getElementById('bdLoading')?.hidden };
  });
  console.log('DIAGNOSI:', JSON.stringify(r, null, 1));
});
