// Verifica #1449 giro 2, rilievo 1: «Valuta» su un secondo campo prima che arrivi il parere sul primo; le correzioni
// del primo parere devono scriversi nel primo campo, non nel secondo.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';
import { prepara, parere } from './_prepara.mjs';

async function valuta(page, sel) {
  await page.locator(sel).click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Valuta')).toHaveCount(1, { timeout: 5000 });
  await menu.voce('Valuta').click();
}

test('r1 il parere sul primo campo corregge il primo campo anche se nel frattempo si è valutato il secondo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await prepara(app, [
    ['Primo', parere({ text: 'uno', correzioni: [{ prima: 'mei', dopo: 'miei', perche: 'refuso' }] })],
    ['', parere({ text: 'due', correzioni: [{ prima: 'erore', dopo: 'errore', perche: 'doppia r' }] })],
  ], 2500);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><textarea id="a" style="width:400px;height:60px">Primo coi mei amici.</textarea><textarea id="b" style="width:400px;height:60px">Secondo coi mei amici e un erore.</textarea>');
  await valuta(page, '#a');
  await page.waitForTimeout(300);
  await valuta(page, '#b');
  const delPrimo = page.locator('.sn-sidebar-correzione', { hasText: 'miei' });
  await expect(delPrimo).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.sn-sidebar-correzione', { hasText: 'errore' })).toHaveCount(1, { timeout: 15_000 });
  await delPrimo.click();
  await expect(page.locator('#a')).toHaveValue('Primo coi miei amici.');
  await expect(page.locator('#b')).toHaveValue('Secondo coi mei amici e un erore.');
});
