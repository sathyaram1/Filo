import { test, expect } from './fixtures/electron.mjs';
const INNER = `<!doctype html><html><body style="margin:0;padding:8px;font:14px sans-serif">
  <a id="inner-link" href="https://example.com/pagina-del-riquadro">un collegamento nel riquadro</a>
</body></html>`;
function outer(src, h) {
  return `<!doctype html><html><body style="margin:0;padding:24px"><iframe id="embed" src="${src}" width="620" height="${h}"></iframe><div style="height:500px"></div></body></html>`;
}
test('diagnosi proiezione', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, outer(testServer.html(INNER), 110));
  page.on('console', (m) => console.log('TOP:', m.text()));
  const frameLoc = page.frameLocator('#embed');
  await frameLoc.locator('#inner-link').click({ button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible({ timeout: 8000 });
  const sub = page.frames().find((f) => f !== page.mainFrame() && f.url().includes('http'));
  sub.on?.('console', () => {});
  console.log('FOCUS_SUB_BEFORE=', await sub.evaluate(() => document.hasFocus()));
  console.log('FOCUS_TOP_BEFORE=', await page.evaluate(() => document.hasFocus()));
  await menu.getByText('Copia URL', { exact: true }).click();
  await page.waitForTimeout(600);
  console.log('FOCUS_SUB_AFTER=', await sub.evaluate(() => document.hasFocus()));
  console.log('FOCUS_TOP_AFTER=', await page.evaluate(() => document.hasFocus()));
  console.log('TOAST_SUB=', await sub.evaluate(() => document.body.innerHTML.includes('sn-toast')));
  console.log('COPIED=', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readText())));
});
