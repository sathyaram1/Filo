import { test, expect } from '../../fixtures/electron.mjs';
const EDITOR = 'filo://editor/editor.html';
async function apri(openTab, modules) {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = { id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [], modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }] };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
  return page;
}
for (const via of ['tasto', 'clic']) {
  test(`sonda ${via}`, async ({ openTab }) => {
    const page = await apri(openTab, [{ id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } },
      { id: 'u-t', type: 'undo', cells: [{ x: 5, y: 0 }], data: { shortcut: 'Ctrl+Z' } }]);
    await page.click('#doc');
    await page.keyboard.press('End');
    await page.keyboard.type(' ABC');
    await page.waitForTimeout(300);
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.locator('#overlay').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(200);
    const abil = await page.evaluate(() => document.queryCommandEnabled('undo'));
    await page.evaluate(() => { window.__log = []; const o = document.execCommand.bind(document); document.execCommand = (c, a, b) => { const r = o(c, a, b); window.__log.push(c + ':' + r + ':' + (document.activeElement && document.activeElement.id)); return r; };
      window.addEventListener('keydown', (e) => window.__log.push('kd ' + e.key + ' t=' + (e.target.id || e.target.tagName) + ' dp=' + e.defaultPrevented), true);
      window.addEventListener('keydown', (e) => window.__log.push('kd-bubble dp=' + e.defaultPrevented)); });
    if (via === 'tasto') await page.keyboard.press('Control+KeyZ');
    else await page.locator('.ed-module[data-type="undo"] button').click();
    await page.waitForTimeout(300);
    console.log(await page.evaluate(() => window.__log.join(' | ')));
    console.log(via, 'undo abilitato prima:', abil, 'testo:', JSON.stringify((await page.locator('#doc').innerText()).slice(0, 20)));
  });
}
