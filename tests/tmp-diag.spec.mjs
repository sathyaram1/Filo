import { test } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
const iso = (g) => new Date(Date.now() - g * 86400000).toISOString();
const fb = (o) => ({ _id: o.id, seq: o.seq, subSeq: 0, name: o.id, text: 'x', clientId: 'u', createdAt: o.at, status: o.status || 'todo', notes: o.notes || '', images: [], priority: 0 });
test('diag fetta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((d) => window.__mgTest.setData(d), [
    fb({ id: 'a', seq: 1, at: iso(1), status: 'done', notes: "R.\n--- Aggiornamento dell'agente del 1/1/2026 ---\nVerifica superata." }),
    fb({ id: 'b', seq: 2, at: iso(1) }),
  ]);
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate(() => window.__mgTest.setStatsWindow('30d'));
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => {
    const p = document.querySelector('#mgStLoopChart [data-group]');
    const legende = [...document.querySelectorAll('.mg-st-legend li')].map((l) => l.dataset.group);
    let arrivato = null, errore = null;
    if (p) {
      document.getElementById('panel-fbstats').addEventListener('contextmenu', (e) => {
        arrivato = e.target.tagName + ' / closest=' + String(!!(e.target.closest && e.target.closest('svg [data-group]')));
      }, { once: true });
      try { p.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })); }
      catch (err) { errore = String(err); }
    }
    return {
      fetta: p ? p.tagName + ' group=' + p.dataset.group : 'ASSENTE',
      legende, arrivato, errore,
      menuNato: document.querySelectorAll('.mg-ctxmenu').length,
      box: p ? JSON.stringify(p.getBoundingClientRect()) : '',
    };
  });
  console.log('DIAG:', JSON.stringify(info, null, 1));
});
