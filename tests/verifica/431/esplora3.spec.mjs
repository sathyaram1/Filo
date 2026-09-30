import { test, expect } from '../../fixtures/electron.mjs';
const FAV = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');
test('resize', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(180_000);
  const pg = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  for (let i = 0; i < 9; i++) await openTab(pg('Titolo della scheda numero ' + i));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 30_000 });
  const ids = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    web.forEach((t, i) => { t.favicon = t.favicon || null; if (i % 3 === 0) t.audible = true; if (i === 4) t.muted = true; });
    w._filoTabs._broadcast();
    return web.map((t) => t.id);
  });
  for (const W of [1280, 900, 700, 560, 480]) {
    await app.evaluate(({ BrowserWindow }, W) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(W, 700); }, W);
    await shell.waitForTimeout(700);
    const r = await shell.evaluate(() => {
      const out = { iw: innerWidth, problemi: [], schede: [] };
      for (const tab of document.querySelectorAll('.tab')) {
        const R = tab.getBoundingClientRect();
        const vis = [...tab.children].filter((c) => getComputedStyle(c).display !== 'none' && getComputedStyle(c).opacity !== '0');
        const alert = tab.querySelector('.tab-alert');
        out.schede.push(Math.round(R.width) + (alert ? (getComputedStyle(alert).display === 'none' ? 'A-NASCOSTO' : 'A') : '') + (tab.querySelector('.favicon') && getComputedStyle(tab.querySelector('.favicon')).display !== 'none' ? 'F' : ''));
        for (const c of vis) { const q = c.getBoundingClientRect(); if (q.width > 0 && (q.left < R.left - 0.5 || q.right > R.right + 0.5)) out.problemi.push(tab.dataset.id.slice(0, 4) + ':' + c.className + ' fuori'); }
      }
      return out;
    });
    console.log(W, JSON.stringify(r));
    await shell.screenshot({ path: `tests/.shots/431g2-resize-${W}.png`, clip: { x: 0, y: 0, width: Math.min(W, 1280), height: 40 } });
  }
});
