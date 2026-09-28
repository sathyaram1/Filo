// #545 giro 2, rilievo 1: «Ctrl+Minus» è lo zoom del foglio anche scritto per nome, e non si salva su un modulo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

for (const sc of ['Ctrl+Minus', 'Ctrl+Shift+Minus']) {
  test(`«${sc}» non si salva in silenzio su un modulo`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await expect(page.locator('#doc')).toBeVisible();
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
    await expect(page.locator('#cfgShortcutTaken')).toContainText('scegline un\'altra');
  });
}
