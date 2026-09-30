// #545 giro 8, rilievo 1: una combinazione che il sistema operativo tiene per sé non si salva su un modulo.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function comeSu(page, piattaforma) {
  await page.addInitScript((p) => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => {
        tasti = v;
        if (!v) return;
        const o = { ...v };
        v.suMac = () => p === 'darwin';
        v.piattaforma = () => p;
        for (const f of ['etichetta', 'etichettaScritta', 'riservato', 'delSistema', 'modificatoreCheCambiaSimbolo']) v[f] = (a) => o[f](a, p);
        v.tastiRiservati = () => o.tastiRiservati(p);
      },
    });
  }, piattaforma);
}

async function apriDocConConteggio(page) {
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ciao mondo' }] }] },
      comments: [],
      modules: [
        { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } },
        { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} },
      ],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}

for (const [piattaforma, scritte] of [
  ['win32', ['Ctrl+Alt+Tab']],
  ['darwin', ['Cmd+`', 'Cmd+Alt+D', 'Cmd+F5']],
]) {
  test(`su ${piattaforma} ${scritte.join(', ')} si rifiutano perché le prende il sistema`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await comeSu(page, piattaforma);
    await apriDocConConteggio(page);
    expect(await page.evaluate(() => window.SN_TASTI.piattaforma())).toBe(piattaforma);
    await page.locator('.ed-module[data-type="settings"]').click();
    await expect(page.locator('#settingsView')).toBeVisible();
    for (const scritta of scritte) {
      await page.locator('.ed-module[data-type="word-count"]').click();
      await page.fill('#cfgShortcut', scritta);
      await page.click('#cfgSave');
      await expect(page.locator('#cfgShortcutTaken'), scritta).toContainText('sistema operativo');
      await page.click('#cfgCancel');
    }
  });
}
