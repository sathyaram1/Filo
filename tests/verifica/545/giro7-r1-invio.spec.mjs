// #545 giro 7, rilievo 1: nel pannello di un modulo, Invio nel campo della scorciatoia salva come «Salva».
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

test('scritta la scorciatoia, Invio la salva e poi parte', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await docConModuli(page, [WC]);
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
  await page.locator('#cfgShortcut').press('Enter');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});
