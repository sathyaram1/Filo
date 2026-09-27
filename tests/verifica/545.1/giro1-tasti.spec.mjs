// Verifica #545.1 giro 1: una scorciatoia di modulo scritta col nome di un
// tasto speciale deve salvarsi e partire alla pressione (o essere rifiutata).
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apri(openTab) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}

async function impostaScorciatoia(page, testo) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await page.fill('#cfgShortcut', testo);
  await page.click('#cfgSave');
}

async function esci(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}

// [scritto, premuto]: il caso del feedback e i nomi naturali vicini.
const CASI = [
  ['Ctrl+Space', 'Control+Space'],
  ['Ctrl+Spazio', 'Control+Space'],
  ['ctrl + space', 'Control+Space'],
  ['Ctrl+Up', 'Control+ArrowUp'],
  ['Ctrl+Su', 'Control+ArrowUp'],
  ['Ctrl+Freccia giù', 'Control+ArrowDown'],
  ['Ctrl+Esc', 'Control+Escape'],
  ['Control+Shift+2', 'Control+Shift+Digit2'],
  ['Ctrl+Enter', 'Control+Enter'],
  ['Ctrl+Invio', 'Control+Enter'],
  ['Ctrl+Shift+Tab', 'Control+Shift+Tab'],
  ['Ctrl+F2', 'Control+F2'],
  ['Ctrl+Canc', 'Control+Delete'],
];

for (const [scritto, premuto] of CASI) {
  test(`«${scritto}» salvata parte alla pressione, anche mentre si scrive`, async ({ openTab }) => {
    const page = await apri(openTab);
    await impostaScorciatoia(page, scritto);
    await expect(page.locator('#cfgShortcut')).toBeHidden();
    await esci(page);
    await page.click('#doc');
    await page.keyboard.type('una prova', { delay: 10 });
    await page.keyboard.press(premuto);
    await expect(page.locator('#overlay')).toBeVisible();
    await expect(page.locator('#overlay')).toContainText('Statistiche documento');
  });
}

// Il nome italiano di Shift: o si riconosce alla pressione, o si rifiuta al salvataggio.
test('«Ctrl+Maiusc+2» non si salva in silenzio per poi non partire', async ({ openTab }) => {
  const page = await apri(openTab);
  await impostaScorciatoia(page, 'Ctrl+Maiusc+2');
  if (await page.locator('#cfgShortcut').isVisible()) {
    await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
    return;
  }
  await esci(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#overlay')).toBeVisible();
});

// Un nome sbagliato si rifiuta con un avviso che dice quale tasto non riconosce.
test('un nome di tasto inventato si rifiuta con un avviso', async ({ openTab }) => {
  const page = await apri(openTab);
  await impostaScorciatoia(page, 'Ctrl+Spazioo');
  await expect(page.locator('#cfgShortcut')).toBeVisible();
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
  await expect(page.locator('#cfgShortcutTaken')).toContainText('Spazioo');
  await page.screenshot({ path: 'tests/.shots/verifica-545-1-avviso.png' });
});
