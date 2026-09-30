import { test, expect } from '../../fixtures/electron.mjs';
const FAV = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');
test('sliver', async ({ app, shell, openTab, testServer }) => {
  const pg = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  await openTab(pg('YouTube'));
  await openTab(pg('Wikipedia'));
  await openTab(pg('Attiva'));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 30_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    web[0].audible = true; web[1].muted = true; w._filoTabs._broadcast();
  });
  await expect(shell.locator('.tab .tab-alert')).toHaveCount(2, { timeout: 10_000 });
  for (const w of [62, 66, 70, 74, 80, 86, 90]) {
    await shell.evaluate((w) => {
      let st = document.getElementById('lz'); if (!st) { st = document.createElement('style'); st.id = 'lz'; document.head.appendChild(st); }
      st.textContent = `.tab:not(.active){flex:0 0 ${w}px!important;min-width:${w}px!important;max-width:${w}px!important}`;
    }, w);
    await shell.waitForTimeout(150);
    const r = await shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => { const ti = t.querySelector('.title'); return getComputedStyle(ti).display === 'none' ? 'nascosto' : Math.round(ti.getBoundingClientRect().width); }));
    console.log(w, JSON.stringify(r));
    await shell.screenshot({ path: `tests/.shots/431g2-sliver-${w}.png`, clip: { x: 0, y: 0, width: 420, height: 40 } });
  }
});
