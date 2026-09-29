// #545 giro 5: esplorazione (si cancella a fine giro).
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const SR = { id: 'sr-t', type: 'search-replace', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };
const REDO = { id: 'r-t', type: 'redo', cells: [{ x: 5, y: 0 }], data: {} };
const UNDO = { id: 'u-t', type: 'undo', cells: [{ x: 6, y: 0 }], data: {} };

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
async function modifica(page, on) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible({ visible: on });
}

const LIBERE = [
  ['Ctrl+Shift+S', 'Control+Shift+KeyS'],
  ['Ctrl+Shift+F', 'Control+Shift+KeyF'],
  ['Ctrl+Alt+S', 'Control+Alt+KeyS'],
  ['Ctrl+Alt+0', 'Control+Alt+Digit0'],
  ['Ctrl+Alt+Z', 'Control+Alt+KeyZ'],
  ['Ctrl+E', 'Control+KeyE'],
  ['Ctrl+K', 'Control+KeyK'],
  ['Ctrl+G', 'Control+KeyG'],
  ['Ctrl+H', 'Control+KeyH'],
  ['Ctrl+D', 'Control+KeyD'],
  ['Ctrl+P', 'Control+KeyP'],
  ['Ctrl+N', 'Control+KeyN'],
  ['Ctrl+O', 'Control+KeyO'],
  ['Ctrl+J', 'Control+KeyJ'],
  ['Ctrl+M', 'Control+KeyM'],
  ['Ctrl+Shift+Y', 'Control+Shift+KeyY'],
  ['Ctrl+Shift+A', 'Control+Shift+KeyA'],
  ['Ctrl+Shift+X', 'Control+Shift+KeyX'],
  ['Alt+F', 'Alt+KeyF'],
  ['Ctrl+Home', 'Control+Home'],
  ['Ctrl+Backspace', 'Control+Backspace'],
];
for (const [sc, press] of LIBERE) {
  test(`libera: ${sc} si salva e parte dal foglio`, async ({ openTab }) => {
    const page = await apri(openTab, [WC]);
    await modifica(page, true);
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    const aperto = await page.locator('#cfgShortcut').count();
    const avviso = aperto ? await page.locator('#cfgShortcutTaken').innerText().catch(() => '') : '';
    const hint = aperto ? await page.locator('#cfgShortcutHint').isVisible() : false;
    if (aperto) { console.log(`[${sc}] RIFIUTATA: ${avviso} ${hint ? '(hint modificatore)' : ''}`); return; }
    await modifica(page, false);
    await page.click('#doc');
    await page.keyboard.press(press);
    await page.waitForTimeout(250);
    const ok = await page.locator('#overlay h3', { hasText: 'Statistiche' }).count();
    console.log(`[${sc}] salvata; premuta dal foglio: ${ok ? 'PARTE' : 'NON PARTE'}`);
    expect(ok, sc).toBe(1);
  });
}

const RIFIUTATE = [
  'Cmd+S', 'Comando+S', '⌘+S', 'ctrl + s', 'Control+\\', 'Ctrl+Shift+0', 'Ctrl+F', 'Ctrl+Y', 'Ctrl+Più', 'Ctrl+Meno',
  'F2', 'Shift+F2', 'Ctrl+Alt+Canc', 'Ctrl+Tab', 'Ctrl+Shift+T', 'Ctrl+Shift+W',
];
test('rifiuti: cosa dice il campo', async ({ openTab }) => {
  const page = await apri(openTab, [WC, COMMENT]);
  await modifica(page, true);
  await page.locator('.ed-module[data-type="comment"]').click();
  for (const sc of RIFIUTATE) {
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    const aperto = await page.locator('#cfgShortcut').count();
    if (!aperto) {
      console.log(`[${sc}] ACCETTATA`);
      await page.locator('.ed-module[data-type="comment"]').click();
      continue;
    }
    const avviso = await page.locator('#cfgShortcutTaken').isVisible() ? await page.locator('#cfgShortcutTaken').innerText() : '';
    const hint = await page.locator('#cfgShortcutHint').isVisible() ? await page.locator('#cfgShortcutHint').innerText() : '';
    console.log(`[${sc}] rifiutata: ${avviso}${hint}`);
  }
});

test('redo e undo col loro tasto', async ({ openTab }) => {
  const page = await apri(openTab, [REDO, UNDO]);
  await modifica(page, true);
  for (const [tipo, sc] of [['redo', 'Ctrl+Y'], ['undo', 'Ctrl+Z'], ['redo', 'Ctrl+Shift+Z']]) {
    await page.locator(`.ed-module[data-type="${tipo}"]`).click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    const aperto = await page.locator('#cfgShortcut').count();
    console.log(`[${tipo} ${sc}] ${aperto ? 'rifiutata: ' + await page.locator('#cfgShortcutTaken').innerText() : 'salvata'}`);
    if (aperto) await page.click('#cfgCancel');
  }
});

test('tasto del modulo premuto nel campo della sua configurazione', async ({ openTab }) => {
  const page = await apri(openTab, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } }, COMMENT]);
  await modifica(page, true);
  await page.locator('.ed-module[data-type="comment"]').click();
  await page.click('#cfgShortcut');
  await page.keyboard.press('Control+Shift+Digit1');
  await page.waitForTimeout(250);
  console.log('dopo Ctrl+Shift+1 nel campo: campo presente?', await page.locator('#cfgShortcut').count(),
    'statistiche?', await page.locator('#overlay h3', { hasText: 'Statistiche' }).count());
  await page.screenshot({ path: 'tests/.shots/verifica-545-g5-campo.png' });
});

test('Ctrl+F senza modulo di ricerca, e dopo averlo aggiunto', async ({ openTab }) => {
  const page = await apri(openTab, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+F' } }]);
  await page.click('#doc');
  await page.keyboard.press('Control+KeyF');
  await page.waitForTimeout(250);
  console.log('Ctrl+F vecchia senza ricerca: statistiche?', await page.locator('#overlay h3', { hasText: 'Statistiche' }).count());
});
