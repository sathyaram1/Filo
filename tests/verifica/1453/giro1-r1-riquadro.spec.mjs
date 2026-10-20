// #1453 r1: un avviso della pagina non deve coprire il menu aperto dentro un riquadro incorporato in basso a destra.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { statoDi } from '../../helpers/riquadri.mjs';

const INNER = `<!doctype html><html><body style="margin:0;height:100vh;font:16px sans-serif">
  <a id="giu" href="https://example.com/giu" style="position:fixed;right:30px;bottom:4px;font-size:12px">in fondo</a>
</body></html>`;

test('r1 menu dentro un riquadro in basso a destra: la voce sotto l’avviso della pagina parte', async ({ app, shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  const inner = testServer.html(INNER).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
    <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
    <iframe id="embed" src="${inner}" style="position:fixed;right:0;bottom:0;width:520px;height:520px;border:0"></iframe>
  </body></html>`);
  await page.waitForTimeout(500);
  await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  await page.waitForTimeout(300);
  const a = await avviso.boundingBox();

  const frameLoc = page.frameLocator('#embed');
  await frameLoc.locator('#giu').click({ button: 'right' });
  const voce = menuDi(frameLoc).voce('Invia feedback');
  await expect(voce).toBeVisible();
  let v = null;
  await expect.poll(async () => {
    const prima = JSON.stringify(v);
    v = await voce.boundingBox();
    return prima === JSON.stringify(v);
  }, { intervals: [300] }).toBe(true);
  const x = Math.max(a.x, v.x) + 6;
  const y = (Math.max(a.y, v.y) + Math.min(a.y + a.height, v.y + v.height)) / 2;
  expect(x < Math.min(a.x + a.width, v.x + v.width) && y > a.y && y < a.y + a.height, 'la voce non cade sull’avviso').toBe(true);
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);

  const frame = page.frames().find((f) => f.url().includes('blocked.test'));
  await expect.poll(async () => (await statoDi(app, page, '.sn-fb-text', frame))?.visibile ?? false,
    { message: 'la voce «Invia feedback» sotto l’avviso non è partita' }).toBe(true);
});
