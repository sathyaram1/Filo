// #545 giro 7: esplorazione, stampa una tabella (accettata? parte? il foglio cambia?).
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const SR = { id: 'sr-t', type: 'search-replace', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} };

async function docConModuli(page, modules) {
  await page.evaluate((mods) => {
    const now = new Date().toISOString();
    const raw = {
      id: 'file-tasti', meta: { title: 'Tasti', created: now, modified: now, version: 1 },
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uno due tre quattro' }] }] },
      comments: [],
      modules: [...mods, { id: 'set-tasti', type: 'settings', cells: [{ x: 11, y: 7 }], data: {} }],
    };
    localStorage.setItem('filo.editor.collection', JSON.stringify({ version: 2, activeId: raw.id, files: [raw] }));
  }, modules);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#doc')).toBeVisible();
}

const CASI = [
  ['Ctrl+F', 'Control+KeyF'], ['Ctrl+=', 'Control+Equal'], ['Ctrl+Plus', null], ['Ctrl+_', null],
  ['Ctrl+Shift+0', 'Control+Shift+Digit0'], ['Ctrl+Alt+0', 'Control+Alt+Digit0'],
  ['Ctrl+Shift+S', 'Control+Shift+KeyS'], ['Ctrl+Shift+F', 'Control+Shift+KeyF'], ['Ctrl+Alt+S', 'Control+Alt+KeyS'],
  ['Ctrl+Backspace', 'Control+Backspace'], ['Ctrl+Freccia sinistra', 'Control+ArrowLeft'],
  ['Ctrl+Shift+Freccia sinistra', 'Control+Shift+ArrowLeft'], ['Ctrl+Home', 'Control+Home'],
  ['Ctrl+End', 'Control+End'], ['Ctrl+Delete', 'Control+Delete'], ['Ctrl+Insert', 'Control+Insert'],
  ['Ctrl+Enter', 'Control+Enter'], ['Ctrl+M', 'Control+KeyM'], ['Ctrl+P', 'Control+KeyP'],
  ['Ctrl+N', 'Control+KeyN'], ['Ctrl+K', 'Control+KeyK'], ['Ctrl+E', 'Control+KeyE'], ['Ctrl+H', 'Control+KeyH'],
  ['Ctrl+Shift+I', 'Control+Shift+KeyI'], ['Ctrl+Shift+C', 'Control+Shift+KeyC'], ['Ctrl+F5', 'Control+F5'],
  ['Alt+G', 'Alt+KeyG'], ['Alt+F', 'Alt+KeyF'], ['Alt+Home', 'Alt+Home'], ['Alt+Freccia su', 'Alt+ArrowUp'],
  ['Ctrl+1', 'Control+Digit1'], ['Ctrl+,', 'Control+Comma'], ['Ctrl+.', 'Control+Period'], ['Ctrl+/', 'Control+Slash'],
  ['Ctrl+[', 'Control+BracketLeft'], ['Ctrl+`', 'Control+Backquote'], ['Ctrl+;', 'Control+Semicolon'],
  ['Ctrl+😀', null], ['Ctrl+Shift+Z', 'Control+Shift+KeyZ'], ['Ctrl+Y', 'Control+KeyY'],
  ['Ctrl+Numpad1', null], ['Ctrl+Backslash', null], ['Ctrl+Shift+Tab', 'Control+Shift+Tab'],
];

test('tabella: accettata e poi parte?', async ({ openTab }) => {
  test.setTimeout(600000);
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await docConModuli(page, [WC, SR]);
  await page.locator('.ed-module[data-type="settings"]').click();
  const righe = [];
  const accettate = [];
  for (const [sc, press] of CASI) {
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    await page.waitForTimeout(50);
    const aperto = await page.locator('#overlay').isVisible();
    if (aperto) {
      const msg = (await page.locator('#cfgShortcutTaken').isVisible()) ? await page.locator('#cfgShortcutTaken').innerText()
        : (await page.locator('#cfgShortcutHint').isVisible()) ? await page.locator('#cfgShortcutHint').innerText() : '?';
      righe.push(`RIFIUTATA ${sc} :: ${msg}`);
      await page.click('#cfgCancel');
    } else {
      accettate.push([sc, press]);
    }
  }
  await page.locator('.ed-module[data-type="settings"]').click();
  for (const [sc, press] of accettate) {
    if (!press) { righe.push(`ACCETTATA ${sc} (non premibile qui)`); continue; }
    await docConModuli(page, [{ ...WC, data: { count: 'words', shortcut: sc } }, SR]);
    await page.click('#doc');
    await page.keyboard.press('End');
    const prima = await page.locator('#doc').innerText();
    await page.keyboard.press(press);
    await page.waitForTimeout(250);
    const parte = await page.locator('#overlay h3', { hasText: 'Statistiche' }).isVisible();
    const dopo = await page.locator('#doc').innerText().catch(() => '?');
    righe.push(`ACCETTATA ${sc} -> ${parte ? 'PARTE' : 'NON PARTE'}${prima !== dopo ? ' (foglio cambiato)' : ''}`);
    if (parte) await page.keyboard.press('Escape');
  }
  console.log('\n' + righe.join('\n'));
});
