// #545 giro 3: esplorazione. Scorciatoie di modulo accettate che poi non fanno niente.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apriDocConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-g3', meta: { title: 'Giro3', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-g3', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
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

const WC = { id: 'wc-g3', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const BOLD = { id: 'b-g3', type: 'bold', cells: [{ x: 3, y: 0 }], data: {} };
const UNDO = { id: 'u-g3', type: 'undo', cells: [{ x: 4, y: 0 }], data: {} };
const ITALIC = { id: 'i-g3', type: 'italic', cells: [{ x: 5, y: 0 }], data: {} };

test('Grassetto con una scorciatoia sua: premuta mette il grassetto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, BOLD]);
  await modifica(page, true);
  await assegna(page, 'bold', 'Ctrl+G');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+KeyG');
  await page.waitForTimeout(300);
  await expect(page.locator('#doc b, #doc strong')).toHaveCount(1);
});

test('Corsivo con Ctrl+Shift+1: premuta mette il corsivo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, ITALIC]);
  await modifica(page, true);
  await assegna(page, 'italic', 'Ctrl+Shift+1');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+KeyA');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.waitForTimeout(300);
  await expect(page.locator('#doc i, #doc em')).toHaveCount(1);
});

test('Indietro con Ctrl+Shift+2: premuta annulla', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC, UNDO]);
  await modifica(page, true);
  await assegna(page, 'undo', 'Ctrl+Shift+2');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' xyz', { delay: 20 });
  await expect(page.locator('#doc')).toContainText('xyz');
  await page.keyboard.press('Control+Shift+Digit2');
  await page.waitForTimeout(300);
  await expect(page.locator('#doc')).not.toContainText('xyz');
});

for (const [sc, press] of [
  ['Ctrl+Shift+\\', 'Control+Shift+Backslash'],
  ['Ctrl+Shift+/', 'Control+Shift+Slash'],
  ['Ctrl+Shift+,', 'Control+Shift+Comma'],
  ['Ctrl+.', 'Control+Period'],
  ['Ctrl+Shift+.', 'Control+Shift+Period'],
]) {
  test(`«${sc}» o si rifiuta o parte`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [WC]);
    await modifica(page, true);
    await assegna(page, 'word-count', sc);
    const salvata = (await page.locator('#cfgShortcut').count()) === 0;
    test.info().annotations.push({ type: 'salvata', description: String(salvata) });
    if (!salvata) { await expect(page.locator('#cfgShortcutTaken, #cfgShortcutHint').first()).toBeVisible(); return; }
    await modifica(page, false);
    await page.click('#doc');
    await page.keyboard.press(press);
    await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible({ timeout: 2000 });
  });
}

test('giro 2: Minus e Ctrl++ si rifiutano per lo zoom', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  await modifica(page, true);
  for (const sc of ['Ctrl+Minus', 'Ctrl+Shift+Minus', 'Ctrl++', 'ctrl + minus', 'Cmd+Minus', 'Control+-']) {
    await assegna(page, 'word-count', sc);
    await expect(page.locator('#cfgShortcutTaken'), sc).toBeVisible();
    await expect(page.locator('#cfgShortcutTaken'), sc).toContainText('zooma');
    await expect(page.locator('#cfgShortcutHint'), sc).toBeHidden();
    await page.click('#cfgCancel');
  }
  for (const sc of ['ctrl+s', ' CTRL + S ', 'Cmd+S', 'Control+s', 'Ctrl+Barra rovesciata', 'Ctrl+F']) {
    await assegna(page, 'word-count', sc);
    await expect(page.locator('#cfgShortcut'), sc).toHaveCount(1);
    await expect(page.locator('#cfgShortcutTaken'), sc).toBeVisible();
    test.info().annotations.push({ type: sc, description: await page.locator('#cfgShortcutTaken').innerText() });
    await page.click('#cfgCancel');
  }
  await assegna(page, 'word-count', 'Ctrl+S');
  await page.screenshot({ path: 'tests/.shots/verifica-545-g3-chiaro.png' });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/verifica-545-g3-scuro.png' });
});
