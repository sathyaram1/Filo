// Sonda: un avviso della pagina sopra un riquadro incorporato copre il menu aperto dentro il riquadro?

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const INNER = `<!doctype html><html><body style="margin:0;height:100vh;font:16px sans-serif">
  <a id="giu" href="https://example.com/giu" style="position:fixed;right:30px;bottom:4px;font-size:12px">in fondo</a>
</body></html>`;

test('menu dentro un riquadro in basso a destra, con un avviso della pagina sopra', async ({ shell, openTab, testServer }) => {
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings', settings: { notifications: { durationSec: 0, soundEnabled: false, sound: 'default' } },
  }));
  const inner = testServer.html(INNER).replace('127.0.0.1', 'blocked.test');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
    <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
    <iframe id="embed" src="${inner}" style="position:fixed;right:0;bottom:0;width:520px;height:520px;border:0"></iframe>
  </body></html>`);
  await page.waitForTimeout(500);
  const menuTop = menuDi(page).locator('.sn-menu');
  await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
  await menuTop.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' }).first().click();
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  await page.waitForTimeout(300);
  const a = await avviso.boundingBox();
  const frame = page.frameLocator('#embed');
  await frame.locator('#giu').click({ button: 'right' });
  const voce = menuDi(frame).voce('Invia feedback');
  await expect(voce).toBeVisible();
  await page.waitForTimeout(1500);
  const v = await voce.boundingBox();
  await page.screenshot({ path: 'tests/.shots/1453-sonda-riquadro.png' });
  const x = Math.max(a.x, v.x) + 6;
  const y = (Math.max(a.y, v.y) + Math.min(a.y + a.height, v.y + v.height)) / 2;
  console.log('avviso', JSON.stringify(a), 'voce', JSON.stringify(v), 'punto', x, y);
  expect(x < Math.min(a.x + a.width, v.x + v.width) && y > a.y && y < a.y + a.height, 'la voce non cade sull’avviso').toBe(true);
  await page.mouse.move(x, y, { steps: 3 });
  await page.waitForTimeout(150);
  await page.mouse.click(x, y);
  await page.waitForTimeout(800);
  const coperto = await frame.locator('.sn-toast', { hasText: 'Il menu era coperto' }).count();
  const avvisoChiuso = await page.locator('.sn-toast').count();
  console.log('coperto nel riquadro', coperto, 'avvisi in pagina', avvisoChiuso);
  await page.screenshot({ path: 'tests/.shots/1453-sonda-riquadro-dopo.png' });
  expect(coperto).toBe(0);
});
