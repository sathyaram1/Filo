// #545 giro 6, rilievo 3: «Ctrl-Shift-2» o «Ctrl Shift 2» non devono sentirsi dire di usare un modificatore che c'è.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

for (const scritto of ['Ctrl-Shift-2', 'Ctrl Shift 2']) {
  test(`«${scritto}» non riceve l'avviso sul modificatore mancante`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#doc')).toBeVisible();
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await page.waitForTimeout(150);
    if (await page.locator('#cfgShortcut').count()) {
      await page.screenshot({ path: 'tests/.shots/verifica-545-g6-separatore.png' });
      await expect(page.locator('#cfgShortcutHint')).toBeHidden();
    }
  });
}
