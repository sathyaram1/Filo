// Esplorazione del riallineamento di #545: la riga in conflitto sul nome di Alt+lettera. Si cancella a fine giro.
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

async function comeSulMac(page) {
  await page.addInitScript(() => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => {
        tasti = v;
        if (!v) return;
        const o = { ...v };
        v.suMac = () => true;
        v.piattaforma = () => 'darwin';
        for (const f of ['etichetta', 'etichettaScritta', 'riservato', 'delSistema', 'modificatoreCheCambiaSimbolo']) v[f] = (a) => o[f](a, 'darwin');
        v.tastiRiservati = () => o.tastiRiservati('darwin');
      },
    });
  });
}

test('Mac: Alt+lettera scritta su un modulo si ripete com\'è, e Ctrl+Alt+E resta di Filo', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await comeSulMac(page);
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Alt+E' } }, COMMENT]);
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);
  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.fill('#cfgShortcut', 'Alt+E');
  await page.click('#cfgSave');
  const t1 = await page.locator('#cfgShortcutTaken').textContent();
  console.log('Mac Alt+E doppia:', t1);
  await expect(page.locator('#cfgShortcutTaken')).toHaveText(/^Alt\+E è già la scorciatoia di «Conteggio parole»/);
  await page.fill('#cfgShortcut', 'Ctrl+Alt+E');
  await page.click('#cfgSave');
  const t2 = await page.locator('#cfgShortcutTaken').textContent();
  console.log('Mac Ctrl+Alt+E:', t2);
  await expect(page.locator('#cfgShortcutTaken')).toBeVisible();
});

for (const tasto of ['Alt+E', 'Alt+T', 'Alt+S', 'Alt+H']) {
  test(`qui: ${tasto} su un modulo si rifiuta perché è di Filo`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [WC]);
    await page.locator('.ed-module[data-type="settings"]').click();
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', tasto);
    await page.click('#cfgSave');
    const t = await page.locator('#cfgShortcutTaken').textContent();
    console.log(tasto, '→', t);
    await expect(page.locator('#cfgShortcutTaken')).toContainText('già di Filo');
    await page.fill('#cfgShortcut', 'Ctrl+Shift+7');
    await page.click('#cfgSave');
    await expect(page.locator('#overlay')).toBeHidden();
  });
}
