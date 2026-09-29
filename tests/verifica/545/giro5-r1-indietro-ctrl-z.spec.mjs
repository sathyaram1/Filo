// #545 giro 5, rilievo 1: Ctrl+Z accettato sul modulo Indietro deve annullare anche fuori dal testo, come il suo clic.
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

test('Indietro con Ctrl+Z salvato: dopo un clic su un modulo il tasto annulla come il clic', async ({ openTab }) => {
  const page = await apri(openTab, [
    { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } },
    { id: 'u-t', type: 'undo', cells: [{ x: 1, y: 0 }], data: {} },
  ]);
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="undo"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+Z');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();

  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.type(' ABC');
  await page.waitForTimeout(300);
  const scritto = await page.locator('#doc').innerText();
  await page.locator('.ed-module[data-type="word-count"]').click();
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#overlay')).toBeHidden();

  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 2000 }).not.toBe(scritto);
});
