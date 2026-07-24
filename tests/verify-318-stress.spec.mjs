// Verifier stress test #318 — black-box.
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function enterSettings(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible();
}
async function exitSettings(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}

// 1) Symptom exact repro: "b" rejected, then typing works.
test('symptom: nuda "b" rifiutata, banana intatta', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await enterSettings(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'b');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutHint')).toBeVisible();
  await page.click('#cfgCancel');
  await exitSettings(page);
  await page.click('#doc');
  await page.keyboard.type('banana', { delay: 20 });
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('banana');
});

// 2) Shift-only shortcut ("Shift+b") must ALSO be rejected (still produces a char).
test('Shift+b senza Ctrl/Alt viene rifiutata', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await enterSettings(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Shift+b');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutHint')).toBeVisible();
  await expect(page.locator('#cfgShortcut')).toHaveClass(/ed-field-invalid/);
});

// 3) A VALID shortcut with real modifier saves (panel closes) and still fires while typing.
test('Ctrl+Shift+1 valida: salva e apre il modulo anche mentre scrivi', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await enterSettings(page);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
  await page.click('#cfgSave');
  // panel closed = saved (no hint shown)
  await expect(page.locator('#settingsView')).toBeVisible(); // still in settings mode
  await expect(page.locator('#cfgShortcut')).toBeHidden();
  await exitSettings(page);
  await page.click('#doc');
  await page.keyboard.type('ab', { delay: 20 });
  // valid modifier shortcut must fire even with focus in the document (like Ctrl+F)
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay')).toBeVisible();
  // and the letters typed before are intact
  expect(await page.locator('#doc').innerText()).toContain('ab');
});

// 4) legacy no-modifier shortcut ("b") must NOT rob letter but the valid trigger
//    (in a non-editable context) still works via the module icon click path.
test('legacy "b" non ruba, ma il modulo resta cliccabile', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    const now = new Date().toISOString();
    localStorage.setItem('filo.editor.doc', JSON.stringify({
      meta: { title: 'L', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
      comments: [],
      modules: [
        { id: 'wc', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'b' } },
        { id: 'set', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    }));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.click('#doc');
  await page.keyboard.type('abba', { delay: 20 });
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await page.locator('#doc').innerText()).toContain('abba');
});
