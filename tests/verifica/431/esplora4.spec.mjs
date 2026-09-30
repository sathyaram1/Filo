import { test, expect } from '../../fixtures/electron.mjs';
const FAV = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#e00"/></svg>');
test('jiggle', async ({ app, shell, openTab, testServer }) => {
  const pg = (t) => testServer.html(`<title>${t}</title><link rel="icon" href="${FAV}"><h1 id="ok">x</h1>`);
  for (const t of ['Gmail', 'Wikipedia', 'YouTube']) await openTab(pg(t));
  await expect(shell.locator('.tab .spinner')).toHaveCount(0, { timeout: 30_000 });
  await shell.waitForTimeout(800);
  const set = (a) => app.evaluate(({ BrowserWindow }, a) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const web = w._filoTabs.tabs.filter((x) => /^https?:/.test(x.url || ''));
    web[2].audible = a; w._filoTabs._broadcast();
  }, a);
  const g = () => shell.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => { const r = t.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }));
  console.log('muto   ', JSON.stringify(await g()));
  await set(true); await shell.waitForTimeout(400);
  console.log('suona  ', JSON.stringify(await g()));
  await shell.screenshot({ path: 'tests/.shots/431g2-jiggle-on.png', clip: { x: 0, y: 0, width: 1280, height: 40 } });
  await set(false); await shell.waitForTimeout(400);
  console.log('muto   ', JSON.stringify(await g()));
  await shell.screenshot({ path: 'tests/.shots/431g2-jiggle-off.png', clip: { x: 0, y: 0, width: 1280, height: 40 } });
});
