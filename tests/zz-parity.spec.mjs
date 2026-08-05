import { test, expect } from './fixtures/electron.mjs';

test('parità: Copia URL immagine con src javascript:', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('SEGNAPOSTO'));
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <img id="i" width="200" height="120" style="background:#abc">
    <script>document.getElementById('i').setAttribute('src','javascript:window.__p=1');</script>
  </body></html>`);
  await page.locator('#i').click({ button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible();
  const t = (await page.locator('.sn-menu').first().textContent()) || '';
  console.log('IMG MENU TEXT >>>', t);
  const copy = page.locator('.sn-menu button', { hasText: /Copia URL immagine/i });
  console.log('copy count', await copy.count());
  if (await copy.count()) { await copy.first().click(); await page.waitForTimeout(600); }
  console.log('CLIP >>>', await app.evaluate(({ clipboard }) => clipboard.readText()));
});
