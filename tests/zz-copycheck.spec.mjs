import { test, expect } from './fixtures/electron.mjs';
const INNER = `<!doctype html><html><body style="margin:0;padding:8px;font:14px sans-serif">
  <p id="inner-text">Testo dentro il riquadro incorporato, abbastanza lungo da selezionarlo.</p>
</body></html>`;
function outer(src, h) {
  return `<!doctype html><html><body style="margin:0;padding:24px"><iframe id="embed" src="${src}" width="480" height="${h}"></iframe><div style="height:500px"></div></body></html>`;
}
test('diagnosi inline', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER), 110));
  page.on('console', (m) => console.log('TOP:', m.type(), m.text()));
  const sub = page.frames().find((f) => f !== page.mainFrame() && f.url().includes('http'));
  await page.frameLocator('#embed').locator('#inner-text').click();
  await sub.evaluate(() => {
    const p = document.querySelector('#inner-text');
    const r = document.createRange(); r.selectNodeContents(p);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.frameLocator('#embed').locator('#inner-text').click({ button: 'right' });
  await page.waitForTimeout(2500);
  console.log('MENU_TOP=', await page.evaluate(() => document.querySelectorAll('.sn-menu').length));
  console.log('MENU_SUB=', await sub.evaluate(() => document.querySelectorAll('.sn-menu').length));
  console.log('SUBLOG=', await sub.evaluate(() => JSON.stringify(window.__snLog || null)));
});
