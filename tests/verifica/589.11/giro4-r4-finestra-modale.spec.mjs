// #589.11 giro 4, rilievo 4: nel campo di una finestra modale del sito il menu sta sotto la finestra e il suo velo grigio.
import { test, expect } from '../../fixtures/electron.mjs';

const SEGRETO = 'pw-Segreta-589-undici';

test('r4 Incolla dal menu nel campo di una finestra modale del sito', async ({ app, openTab, testServer }) => {
  await app.evaluate(({ clipboard }, s) => clipboard.writeText(s), SEGRETO);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <dialog id="d"><input id="campo" style="width:300px;font-size:16px"></dialog>
    <script>document.getElementById('d').showModal();</script></body></html>`);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1');
  await page.locator('#campo').click({ button: 'right' });
  await expect(page.locator('.sn-menu-paste-main')).toHaveCount(1);
  await page.waitForTimeout(700);
  const b = await page.locator('.sn-menu-paste-main').boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.locator('#campo')).toHaveValue(SEGRETO);
});
