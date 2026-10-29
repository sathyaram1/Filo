import { test, expect } from '../../fixtures/electron.mjs';
test('dbg', async ({ app, openTab }) => {
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForFunction(() => document.querySelector('.pd-pannello') && document.querySelector('.pd-elemento[data-elemento="word-count"]'));
  await ed.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1' && typeof window.SN_SIDEBAR?.open === 'function');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.barra.esegui('help'));
  await expect(ed.locator('.sn-sidebar')).toBeVisible();
  await ed.waitForTimeout(600);
  const m = await ed.evaluate(() => {
    const s = document.querySelector('.pd-striscia').getBoundingClientRect();
    const el = document.elementFromPoint(s.left + s.width / 2, 400);
    return { cls: document.documentElement.className, s: JSON.parse(JSON.stringify(s)), el: el && (el.className || el.tagName), destra: getComputedStyle(document.documentElement).getPropertyValue('--pd-destra') };
  });
  console.log(JSON.stringify(m));
  const s = await ed.locator('.pd-striscia').boundingBox();
  await ed.mouse.click(s.x + s.width / 2, 400);
  await ed.waitForTimeout(800);
  console.log('dopo', await ed.evaluate(() => document.documentElement.className), await ed.evaluate(() => document.querySelector('.sn-sidebar')?.className));
  await ed.screenshot({ path: 'tests/.shots/g4-dbg.png' });
});
