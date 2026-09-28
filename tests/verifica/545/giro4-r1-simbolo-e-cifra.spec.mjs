// #545 giro 4, rilievo 1: lo stesso tasto scritto come simbolo e come Shift+cifra non si salva su due moduli.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };

async function apriDocConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
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

// Su tastiera italiana e americana «!» si fa con Shift+1: è la stessa pressione.
for (const [primo, secondo] of [['Ctrl+Shift+1', 'Ctrl+!'], ['Ctrl+!', 'Ctrl+Shift+1']]) {
  test(`«${secondo}» su Commenta, con «${primo}» su Conteggio parole: si rifiuta o parte Commenta`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: primo } }, COMMENT]);
    await modifica(page, true);
    await page.locator('.ed-module[data-type="comment"]').click();
    await page.fill('#cfgShortcut', secondo);
    await page.click('#cfgSave');
    await page.waitForTimeout(150);
    if (await page.locator('#cfgShortcut').count()) {
      await expect(page.locator('#cfgShortcutTaken')).toContainText('Conteggio parole');
      return;
    }
    await modifica(page, false);
    await page.click('#doc');
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#root')).toHaveClass(/commenting/);
  });
}
