// #545 giro 7, rilievo 3: su Mac l'avviso nomina la combinazione che l'utente ha scritto, non un'altra.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words', shortcut: 'Alt+1' } };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };

test('su Mac «Alt+1» e «Alt+-» restano Alt+1 e Alt+- nell\'avviso', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  // Mac simulato: ogni regola di SN_TASTI che dipende dal sistema risponde come su Mac.
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
        for (const f of ['etichetta', 'acceleratoreElectron', 'riservato', 'delSistema', 'modificatoreCheCambiaSimbolo']) v[f] = (a) => o[f](a, 'darwin');
        v.tastiRiservati = () => o.tastiRiservati('darwin');
        v.frase = (t, a) => o.frase(t, a, 'darwin');
      },
    });
  });
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = { id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno due tre' }] }] },
      comments: [], modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }] };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, [WC, COMMENT]);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => window.SN_TASTI.suMac())).toBe(true);

  await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator('.ed-module[data-type="comment"]').click();
  for (const scritto of ['Alt+1', 'Alt+-']) {
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    const avviso = page.locator('#cfgShortcutTaken');
    await expect(avviso, scritto).toBeVisible();
    await expect(avviso, scritto).toContainText(scritto);
    await expect(avviso, scritto).not.toContainText(/Cmd\+1|Ctrl\+Alt\+-/);
  }
});
