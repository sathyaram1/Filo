import { test, expect } from './fixtures/electron.mjs';

function pageHtml(videoSrc) {
  return `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
    <h1>Articolo con filmato</h1>
    <video id="v" src="${videoSrc}" width="320" height="180" style="background:#333"></video>
    <audio id="a" src="${videoSrc}" controls style="display:block;width:300px"></audio>
    <p id="testo">Un paragrafo qualsiasi sotto al video.</p>
  </body></html>`;
}

test('dbg3', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, pageHtml('/nonexistent.mp4'));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const menu = page.locator('.sn-menu');
  await page.locator('#v').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(menu).toBeVisible();
  await menu.locator('button', { hasText: 'Velocità' }).first().click();
  await expect.poll(() => page.evaluate(() => document.getElementById('v').playbackRate)).toBe(1.25);
  console.log('rate ok');
  await page.locator('#v').click({ button: 'right', position: { x: 20, y: 20 } });
  for (let i = 0; i < 12; i++) {
    const s = await page.evaluate(() => ({
      menus: document.querySelectorAll('.sn-menu').length,
      toasts: document.querySelectorAll('.sn-toast').length,
      host: document.querySelector('.sn-toasts')?.className || null,
    }));
    console.log(i, JSON.stringify(s));
    await page.waitForTimeout(300);
  }
});
