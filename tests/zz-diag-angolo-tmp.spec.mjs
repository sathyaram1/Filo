// Diagnostica temporanea: dove finiscono menu e sotto-menu al variare della
// finestra. Serve a capire se l'angolo (4,4) — usato come "punto vuoto" da
// clipboard-history-remove — è davvero fuori dal sotto-menu.
import { test, expect } from './fixtures/electron.mjs';

const PAGE_HTML = `<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="5" cols="60"></textarea></body></html>`;

for (const [w, h] of [[1280, 800], [1000, 620], [800, 520], [700, 420]]) {
  test(`rettangoli a ${w}x${h}`, async ({ openTab, testServer }) => {
    const page = await openTab(testServer.html(PAGE_HTML));
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    await page.evaluate(() => chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: {},
    })).catch(() => {});
    await page.locator('#ta').click({ button: 'right' });
    await expect(page.locator('.sn-menu')).toBeVisible();
    const arrow = page.locator('.sn-menu-paste-arrow');
    const n = await arrow.count();
    console.log(`[${w}x${h}] frecce cronologia: ${n}`);
    if (!n) return;
    await arrow.hover();
    const sub = page.locator('.sn-menu-history-sub');
    const visibile = await sub.isVisible().catch(() => false);
    const info = await page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const box = (b) => (b ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null);
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        menu: box(r(document.querySelector('.sn-menu:not(.sn-menu-sub)'))),
        sub: box(r(document.querySelector('.sn-menu-history-sub'))),
        sotto4: (document.elementFromPoint(4, 4) || {}).className || null,
      };
    });
    console.log(`[${w}x${h}] visibile=${visibile}`, JSON.stringify(info));
  });
}
