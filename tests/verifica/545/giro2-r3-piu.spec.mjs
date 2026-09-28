// #545 giro 2, rilievo 3: «Ctrl++» ha un modificatore; se si rifiuta, il motivo è lo zoom, non «usa un modificatore».
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

test('«Ctrl++» si rifiuta col motivo vero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await expect(page.locator('#doc')).toBeVisible();
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl++');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await expect(page.locator('#cfgShortcutHint')).toBeHidden();
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
});
