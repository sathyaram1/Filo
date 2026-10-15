// Verifica #842, giro 1: le prove dei rilievi 1, 2 e 3.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

const chiedi = (app, valore) => app.evaluate((_e, v) => globalThis.SN_EXECUTE_FILO_ACTION(
  { type: 'IMPOSTA_PREFERENZA', chiave: 'scorciatoia', valore: v }, { sender: null }), valore);

function premi(app, keyCode, modifiers = []) {
  return app.evaluate(({ BrowserWindow }, o) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    const wc = t.view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: o.keyCode, modifiers: o.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: o.keyCode, modifiers: o.modifiers });
  }, { keyCode, modifiers });
}

async function scorciatoiaModulo(page, combinazione) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', combinazione);
  await page.click('#cfgSave');
}

test('r1 una combinazione già data a un modulo dell\'Editor non diventa la scorciatoia di Traduci', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await expect(page.locator('#doc')).toBeVisible();
  await scorciatoiaModulo(page, 'Ctrl+Shift+Y');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
  await page.click('#doc');
  // Il modulo parte col suo tasto.
  await premi(app, 'Y', ['control', 'shift']);
  await expect(page.locator('#overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();

  // Chiesto a Filo, Traduci su quella combinazione va rifiutato col motivo, o il modulo non parte più.
  const r = await chiedi(app, 'Traduci: Ctrl+Shift+Y');
  expect(r.executed).toBe(false);
  await page.click('#doc');
  await premi(app, 'Y', ['control', 'shift']);
  await expect(page.locator('#overlay')).toBeVisible();
});

test('r2 su Mac «Ctrl+Shift+A» detto a Filo vale Cmd+Shift+A come «Ctrl+Shift+Y» vale Cmd+Shift+Y', async ({ app }) => {
  const letto = await app.evaluate(() => ['Ctrl+Shift+Y', 'Ctrl+Shift+A', 'Ctrl+Shift+Spazio', 'Ctrl+PagGiù']
    .map((s) => globalThis.SN_TASTI.scorciatoiaDaScritta(s, 'darwin')));
  expect(letto).toEqual([
    { accel: 'Ctrl+Shift+Y' }, { accel: 'Ctrl+Shift+A' }, { accel: 'Ctrl+Shift+Spazio' }, { accel: 'Ctrl+PagGiù' },
  ]);
});

test('r3 un modulo dell\'Editor rifiuta il tasto del microfono delle chat come lo rifiutano le azioni di Filo', async ({ app, openTab }) => {
  expect((await chiedi(app, 'Traduci: Ctrl+Shift+Spazio')).executed).toBe(false);
  const page = await openTab(EDITOR);
  await expect(page.locator('#doc')).toBeVisible();
  await scorciatoiaModulo(page, 'Ctrl+Shift+Spazio');
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
});
