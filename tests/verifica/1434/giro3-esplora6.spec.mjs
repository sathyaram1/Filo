// Verifica #1434 giro 3: esplorazione (si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
test('esplora: hover e immagine', async ({ openTab, testServer }) => {
  const img = testServer.asset(PNG, 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px"><img id="foto" src="${img}" width="160" height="110" style="background:#c45a3b"></body></html>`);
  const menu = menuDi(page);
  await page.locator('#foto').click({ button: 'right' });
  const ask = menu.locator('.sn-menu-row [data-sn-icon-id="immagine:ask"]');
  await expect(ask).toBeVisible();
  const b = await ask.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(1500);
  await menu.superficie.screenshot({ path: 'tests/.shots/1434-g3/immagine-hover.png' });
});
