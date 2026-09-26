import { test, expect } from '../../fixtures/electron.mjs';

const tabInfo = (app, host) => app.evaluate(({ BrowserWindow }, h) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w._filoTabs) continue;
    for (const t of w._filoTabs.tabs) {
      let u = '';
      try { u = new URL(t.view.webContents.getURL()).hostname; } catch (_) {}
      if (u === h) return { level: t.sbLevel || null, keys: Object.keys(t).filter((k) => /sb/i.test(k)), v: t.sbVerdict ? JSON.stringify(t.sbVerdict).slice(0, 300) : null };
    }
  }
  return null;
}, host);

for (const [url, host] of [['https://google.github.io/styleguide/', 'google.github.io'], ['https://github.github.io/fetch/', 'github.github.io']]) {
  test('rete vera ' + host, async ({ app, openTab, shell }) => {
    const page = await openTab(url);
    await page.waitForLoadState('load').catch(() => {});
    const visti = [];
    const fine = Date.now() + 15_000;
    while (Date.now() < fine) {
      const l = await tabInfo(app, host);
      visti.push(l && l.level);
      await page.waitForTimeout(1000);
    }
    console.log(host, JSON.stringify(visti), JSON.stringify(await tabInfo(app, host)), await page.title());
    expect(visti.length).toBeGreaterThan(0);
  });
}
