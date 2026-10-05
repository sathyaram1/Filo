// #545 giro 1: una scorciatoia che l'Editor o un altro modulo già servono non si salva su un modulo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apri(openTab) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}
async function modifica(page, on) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible({ visible: on });
}
async function assegna(page, tipo, sc) {
  await page.locator(`.ed-module[data-type="${tipo}"]`).click();
  await page.fill('#cfgShortcut', sc);
  await page.click('#cfgSave');
}

for (const [sc, press, effetto] of [
  ['Ctrl+S', 'Control+s', null],
  ['Ctrl+\\', 'Control+Backslash', 'sidebar'],
  ['Ctrl+0', 'Control+0', null],
  ['Ctrl+-', 'Control+Minus', null],
]) {
  test(`${sc} dell'Editor non si salva su un modulo, e il tasto resta all'Editor`, async ({ openTab }) => {
    const page = await apri(openTab);
    await modifica(page, true);
    await assegna(page, 'word-count', sc);
    await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
    await expect(page.locator('#cfgShortcutTaken')).toContainText('scegline un\'altra');
    await page.click('#cfgCancel');
    await modifica(page, false);
    const prima = await page.locator('#root').getAttribute('class');
    await page.click('#doc');
    await page.keyboard.press(press);
    await page.waitForTimeout(200);
    await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toHaveCount(0);
    if (effetto === 'sidebar') expect(await page.locator('#root').getAttribute('class')).not.toBe(prima);
  });
}

test('una scorciatoia libera parte, e un secondo modulo non può prenderla', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="italic"]').click();
  await page.waitForSelector('.ed-module[data-type="italic"]');
  await modifica(page, true);
  await assegna(page, 'word-count', 'Ctrl+Shift+1');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await assegna(page, 'italic', 'Ctrl+Shift+1');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-545-avviso.png' });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/verifica-545-avviso-scuro.png' });
  await page.click('#cfgCancel');
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});
