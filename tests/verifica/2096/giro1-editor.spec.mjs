// Verifica #2096 giro 1: il tasto destro su una voce dell'elenco documenti dell'Editor apre il menu di quel documento.
import { test, expect } from '../../fixtures/electron.mjs';

test('Editor: tasto destro su un documento dell\'elenco, Duplica lo duplica e l\'elenco resta aperto', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://editor/');
  await expect(page.locator('#docSwitch')).toBeVisible({ timeout: 15_000 });
  await page.locator('#docSwitch').click();
  const voci = page.locator('#docPop .ed-doc-item');
  await expect(voci).toHaveCount(1);
  await voci.first().click({ button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.sn-select-option', { hasText: 'Duplica' })).toBeVisible();
  await expect(menu.locator('.sn-select-option', { hasText: 'Rigenera titolo' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/verifica-2096-editor.png' });
  await menu.locator('.sn-select-option', { hasText: 'Duplica' }).click();
  await expect(page.locator('#docPop')).toBeVisible();
  await expect(voci).toHaveCount(2, { timeout: 5_000 });
});
