// Verifica #725.2 giro 4: nel menu vero (non in node) l'elenco dei marchi e dei suffissi c'è.
import { test, expect } from '../../fixtures/electron.mjs';

const CASI = [
  ['https://m.media-amazon.com/images/x.jpg', false],
  ['https://microsoft.sharepoint.com/sites/x', false],
  ['https://google-research.github.io/', false],
  ['https://paypal-login.vercel.app/', true],
  ['https://paypal-login.evil.com/', true],
];

for (const [href, sospetto] of CASI) {
  test(`${href}: ${sospetto ? 'avviso' : 'nessun avviso'}`, async ({ openTab, testServer }) => {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
      <p><a id="lnk" href="${href}">Il link</a></p></body></html>`);
    await page.locator('#lnk').click({ button: 'right' });
    await expect(page.locator('.sn-menu .sn-menu-inline[data-subject="link"]')).toBeVisible();
    const avviso = page.locator('.sn-menu .sn-menu-link-warn');
    if (sospetto) {
      await expect(avviso).toBeVisible({ timeout: 3000 });
      expect(await avviso.textContent()).toMatch(/paypal\.com.*imitazione/);
    } else {
      await page.waitForTimeout(800);
      await expect(avviso).toHaveCount(0);
    }
  });
}
