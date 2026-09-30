// #545 giro 7, rilievo 2: un tasto che nel foglio fa già qualcosa (Ctrl+Backspace cancella una
// parola) non si dà a un modulo in silenzio: o si rifiuta con un avviso, o nel foglio continua a farlo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };

async function docConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = { id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno due tre' }] }] },
      comments: [], modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }] };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}

for (const [scritto, premuto] of [['Ctrl+Backspace', 'Control+Backspace'], ['Ctrl+Canc', null], ['Ctrl+Freccia sinistra', null]]) {
  test(`«${scritto}» su un modulo: avviso, oppure il foglio lo fa ancora`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await docConModuli(page, [WC]);
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    if (await page.locator('#overlay').isVisible()) {
      await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
      return;
    }
    expect(premuto, `${scritto} si è salvata senza avvisi`).toBeTruthy();
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.click('#doc');
    await page.keyboard.press('End');
    await page.keyboard.press(premuto);
    await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toContain('tre');
  });
}
