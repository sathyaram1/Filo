// #545 giro 4, rilievo 2: l'esempio proposto da un avviso si può salvare davvero.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Ctrl+Shift+1' } };
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

// Alt+F4 lo tiene il sistema su Windows e Linux; «Pippo» non è un modificatore.
for (const scritta of ['Alt+F4', 'Ctrl+Pippo+2']) {
  test(`l'avviso per «${scritta}» propone una combinazione che poi si salva`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [WC, COMMENT]);
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    await page.locator('.ed-module[data-type="comment"]').click();
    await page.fill('#cfgShortcut', scritta);
    await page.click('#cfgSave');
    const avviso = await page.locator('#cfgShortcutTaken').innerText();
    const esempio = (/(?:per esempio|es\.)\s+(\S+?)[.)]?$/m.exec(avviso) || [])[1];
    expect(esempio, avviso).toBeTruthy();
    await page.fill('#cfgShortcut', esempio);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcut'), `${esempio} proposto e poi rifiutato`).toHaveCount(0);
  });
}
