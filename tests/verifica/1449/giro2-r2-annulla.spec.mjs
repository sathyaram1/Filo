// Verifica #1449 giro 2, rilievo 2: una correzione scritta e poi annullata con Ctrl+Z nel campo resta segnata come
// scritta, e il clic non la scrive più.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { prepara, parere } from './_prepara.mjs';

test('r2 dopo Ctrl+Z nel campo la correzione si può scrivere di nuovo con un clic', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [['', parere({ text: 'ok', correzioni: [{ prima: 'erore', dopo: 'errore', perche: 'doppia r' }] })]]);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="ta" style="width:400px;height:60px">Un erore qui.</textarea>');
  await page.locator('#ta').click({ button: 'right' });
  await menuDi(page).voce('Valuta').click();
  const c = page.locator('.sn-sidebar-correzione');
  await expect(c).toHaveCount(1, { timeout: 15_000 });
  await c.click();
  await expect(page.locator('#ta')).toHaveValue('Un errore qui.');
  await page.locator('#ta').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#ta')).toHaveValue('Un erore qui.');
  await c.click();
  await expect(page.locator('#ta')).toHaveValue('Un errore qui.');
});
