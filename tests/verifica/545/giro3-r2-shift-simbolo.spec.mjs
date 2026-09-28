// #545 giro 3, rilievo 2: Ctrl+Shift più un tasto di punteggiatura si salva
// e alla pressione non parte (il tasto arriva col simbolo di Shift).
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

for (const [sc, press] of [
  ['Ctrl+Shift+\\', 'Control+Shift+Backslash'],
  ['Ctrl+Shift+/', 'Control+Shift+Slash'],
  ['Ctrl+Shift+,', 'Control+Shift+Comma'],
  ['Ctrl+Shift+.', 'Control+Shift+Period'],
]) {
  test(`«${sc}» o si rifiuta o, premuta, apre il modulo`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#doc')).toBeVisible();
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    if (await page.locator('#cfgShortcut').count()) {
      await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
      return;
    }
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeHidden();
    await page.click('#doc');
    await page.keyboard.press(press);
    await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  });
}
