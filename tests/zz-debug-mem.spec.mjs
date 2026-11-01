import { test, expect } from './fixtures/electron.mjs';
async function newtabPage(app) {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://newtab')), { timeout: 10_000 }).toBe(true);
  const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}
test('debug', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  const tele = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const p = (await cdp.send('Runtime.evaluate', { expression: 'HTMLCanvasElement.prototype', objectGroup: 'g' })).result.objectId;
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: p, objectGroup: 'g' });
    const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function () { return this.length; }', returnByValue: true, objectGroup: 'g' });
    await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'g' });
    return result.value;
  };
  const log = [];
  log.push(['start', await tele()]);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await page.evaluate(() => window.SN_FEEDBACK_UI.close());
    log.push(['evalopenclose', await tele()]);
  }
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    await expect(page.locator('.sn-fb-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sn-fb-modal')).toHaveCount(0);
    log.push(['visible+esc', await tele()]);
  }
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.SN_FEEDBACK_UI.open());
    const box = await page.locator('.sn-fb-canvas').boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 90); await page.mouse.up();
    await page.evaluate(() => window.SN_FEEDBACK_UI.close());
    log.push(['draw', await tele()]);
  }
  console.log(JSON.stringify(log));
});
