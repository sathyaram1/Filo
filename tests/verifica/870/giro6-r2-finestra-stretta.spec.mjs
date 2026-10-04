// #870 giro 6, rilievo 2: con la finestra alla larghezza minima il campo di scrittura resta sotto il centro, non sotto la colonna di sinistra.
import { test, expect } from '../../fixtures/electron.mjs';

test('alla larghezza minima il campo di scrittura sta al centro della home', async ({ app }) => {
  let page = null;
  const scad = Date.now() + 15_000;
  while (!page && Date.now() < scad) {
    page = app.windows().find((x) => { try { return x.url().startsWith('filo://newtab'); } catch (_) { return false; } });
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 760));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(720);
  await page.waitForTimeout(400);
  const { centro, meta } = await page.evaluate(() => {
    const r = document.querySelector('#inputForm').getBoundingClientRect();
    return { centro: r.left + r.width / 2, meta: innerWidth / 2 };
  });
  expect(Math.abs(centro - meta)).toBeLessThan(40);
});
