import { test, expect } from '/home/user/Filo/tests/fixtures/electron.mjs';
test('diag 398', async ({ app, openTab }) => {
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('/192.168.1.1');
  await input.press('Enter');
  await new Promise((r) => setTimeout(r, 6000));
  console.log('FINESTRE ' + JSON.stringify(app.windows().map((w) => w.url())));
  const snap = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return (w && w._filoTabs) ? w._filoTabs.snapshot().tabs.map((t) => t.url) : null;
  });
  console.log('SCHEDE ' + JSON.stringify(snap));
});
