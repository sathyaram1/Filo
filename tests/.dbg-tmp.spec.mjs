import { test, expect } from './fixtures/electron.mjs';
const dump = () => ({ inner: window.innerHeight, client: document.documentElement.clientHeight, vv: window.visualViewport?.height, ev: window.__ev||[] });
test('dbg setViewportSize', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const page = await openTab('filo://newtab/');
  await page.evaluate(() => { window.__ev = []; window.addEventListener('resize', () => window.__ev.push(window.innerHeight)); });
  console.log('PRIMA', JSON.stringify(await page.evaluate(dump)));
  try {
    await page.setViewportSize({ width: 1280, height: 520 });
    console.log('setViewportSize ok');
  } catch (e) { console.log('setViewportSize ERR', e.message); }
  await page.waitForTimeout(800);
  console.log('DOPO', JSON.stringify(await page.evaluate(dump)));
});
