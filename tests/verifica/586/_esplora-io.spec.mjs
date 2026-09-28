// Esplorazione (si cancella): foto del menu nello strato alto, con la cronologia aperta.
import { test, expect } from '../../fixtures/electron.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test('foto', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo copiato'));
  const page = await testServer.openReady(openTab, '<!doctype html><title>F</title><style>body{font:16px sans-serif;background:#fff}</style><p>Un paragrafo della pagina.</p><input id="c" style="width:300px">');
  await page.locator('#c').click({ button: 'right' });
  await page.locator('.sn-menu .sn-menu-paste-main').first().click();
  await page.locator('#c').click({ button: 'right' });
  await expect(page.locator('.sn-menu')).toBeVisible();
  await page.locator('.sn-menu-paste-arrow').hover();
  await sleep(800);
  await page.screenshot({ path: 'tests/.shots/586-giro15-menu-strato.png' });
});
