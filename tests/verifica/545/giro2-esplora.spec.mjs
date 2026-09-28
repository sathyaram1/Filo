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

const CASI = [
  ['Ctrl+Minus', 'Control+Minus'],
  ['Ctrl+Shift+Minus', 'Control+Shift+Minus'],
  ['Ctrl+Shift+T', 'Control+Shift+KeyT'],
  ['Ctrl+Shift+W', null],
  ['Ctrl+Shift+R', 'Control+Shift+KeyR'],
  ['Ctrl+Shift+L', 'Control+Shift+KeyL'],
  ['Ctrl+F', 'Control+KeyF'],
  ['Cmd+S', null],
  ['Control+\\', null],
  ['ctrl + s', null],
  ['Ctrl+Plus', null],
  ['Ctrl+=', null],
  ['Ctrl++', null],
  ['Ctrl+Shift+S', 'Control+Shift+KeyS'],
  ['Ctrl+Shift+F', 'Control+Shift+KeyF'],
  ['Ctrl+Shift+0', 'Control+Shift+Digit0'],
  ['Alt+Shift+T', 'Alt+Shift+KeyT'],
];

for (const [sc, press] of CASI) {
  test(`esplora ${sc}`, async ({ app, openTab }) => {
    const page = await apri(openTab);
    await modifica(page, true);
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await page.waitForTimeout(200);
    const aperto = await page.locator('#cfgShortcut').count();
    const presa = aperto ? await page.locator('#cfgShortcutTaken').isVisible() : false;
    const hint = aperto ? await page.locator('#cfgShortcutHint').isVisible() : false;
    const testo = presa ? await page.locator('#cfgShortcutTaken').innerText() : (hint ? await page.locator('#cfgShortcutHint').innerText() : '');
    let esito = 'salvata';
    if (aperto) esito = 'rifiutata';
    let parte = '-';
    let finestre = '-';
    if (!aperto && press) {
      await modifica(page, false);
      await page.click('#doc');
      const prima = app.windows().length;
      await page.keyboard.press(press);
      await page.waitForTimeout(700);
      parte = String(await page.locator('#overlay h3', { hasText: 'Statistiche' }).count() > 0);
      finestre = `${prima}->${app.windows().length}`;
    }
    console.log(`ESPLORA ${sc} :: ${esito} :: presa=${presa} hint=${hint} :: ${testo} :: parte=${parte} finestre=${finestre}`);
  });
}
