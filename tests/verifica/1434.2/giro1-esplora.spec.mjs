// Verifica #1434.2, giro 1: sguardo alla fila in una password e alle icone della finestra spente.

import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const esegui = (app, azione) => app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a), azione);

for (const tema of ['light', 'dark']) {
  test(`esplora: aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    await esegui(app, { type: 'SPOSTA_ICONA', icona: 'back', dove: 'fila', contesto: 'pagina' });
    await esegui(app, { type: 'SPOSTA_ICONA', icona: 'forward', dove: 'fila', contesto: 'pagina' });
    await esegui(app, { type: 'SPOSTA_ICONA', icona: 'reload', dove: 'fila', contesto: 'pagina' });
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:40px;height:900px">
      <input id="segreta" type="password" value="segreta123" style="display:block;width:300px;font:16px sans-serif">
      <div id="vuoto" style="height:300px"></div></body></html>`);
    await page.emulateMedia({ colorScheme: tema });
    const menu = menuDi(page);
    await page.locator('#segreta').focus();
    await page.keyboard.press('Control+a');
    await page.locator('#segreta').click({ button: 'right', position: { x: 12, y: 8 } });
    await expect(menu.locator('.sn-menu-row')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/1434.2-password-${tema}.png` });
    await page.keyboard.press('Escape');
    await page.locator('#vuoto').click({ button: 'right' });
    await expect(menu.locator('.sn-menu-row [data-sn-icon-id="back"]')).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tests/.shots/1434.2-finestra-${tema}.png` });
  });
}
