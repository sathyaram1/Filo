// #545 giro 5, rilievo 3: a pannello aperto la tastiera è del pannello (Esc chiude, i tasti premuti nel campo non agiscono dietro).
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function apri(openTab, modules) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
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
  return page;
}
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Ctrl+Shift+1' } };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };

test('la combinazione di un altro modulo premuta nel campo non chiude il pannello, e la barra dietro resta com\'è', async ({ openTab }) => {
  const page = await apri(openTab, [WC, COMMENT]);
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.click('#cfgShortcut');
  const barra = await page.locator('#root').getAttribute('class');
  await page.keyboard.press('Control+Backslash');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.waitForTimeout(250);
  await expect(page.locator('#cfgShortcut')).toHaveCount(1);
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toHaveCount(0);
  expect(await page.locator('#root').getAttribute('class')).toBe(barra);
});

test('Esc chiude il pannello di un modulo e quello delle statistiche', async ({ openTab }) => {
  const page = await apri(openTab, [WC, COMMENT]);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.click('#cfgShortcut');
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
});
