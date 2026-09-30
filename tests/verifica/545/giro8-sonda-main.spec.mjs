// #545 giro 8, sonda: il tasto passa dal main (sendInputEvent), come una pressione vera.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

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

async function premiDalMain(app, keyCode, modifiers) {
  await app.evaluate(({ webContents }, { keyCode, modifiers }) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://editor'));
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, { keyCode, modifiers });
}

for (const [scritta, keyCode, modifiers] of [
  ['Ctrl+Shift+1', '1', ['control', 'shift']],
  ['Alt+Shift+Left', 'Left', ['alt', 'shift']],
  ['Ctrl+Shift+T', 'T', ['control', 'shift']],
  ['Ctrl+Q', 'Q', ['control']],
  ['Ctrl+M', 'M', ['control']],
]) {
  test(`sonda ${scritta}`, async ({ app, openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [{ id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } }]);
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritta);
    await page.click('#cfgSave');
    const accettata = !(await page.locator('#overlay').isVisible());
    if (!accettata) { console.log(`SONDA ${scritta}: rifiutata`); return; }
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.click('#doc');
    const schedePrima = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
    await premiDalMain(app, keyCode, modifiers);
    let partita = false;
    try { await page.locator('#overlay h3', { hasText: 'Statistiche' }).waitFor({ state: 'visible', timeout: 1500 }); partita = true; } catch (_) {}
    const schedeDopo = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length);
    console.log(`SONDA ${scritta}: accettata, partita=${partita}, webContents ${schedePrima}→${schedeDopo}, url=${page.url()}`);
  });
}
