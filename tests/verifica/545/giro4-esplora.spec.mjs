// #545 giro 4, esplorazione: ogni scorciatoia che il campo accetta deve partire.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const SR = { id: 'sr-t', type: 'search-replace', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }], data: {} };
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
async function modifica(page, on) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeVisible({ visible: on });
}

const CASI = [
  ['ctrl+s', 'Control+KeyS'], ['CTRL+S', 'Control+KeyS'], ['Ctrl + S', 'Control+KeyS'],
  ['Control+S', 'Control+KeyS'], ['Cmd+S', 'Control+KeyS'], ['Comando+S', 'Control+KeyS'],
  ['Ctrl+Più', 'Control+Equal'], ['Ctrl+Meno', 'Control+Minus'], ['Ctrl+Uguale', 'Control+Equal'],
  ['Ctrl+Equal', 'Control+Equal'], ['Ctrl+Backslash', 'Control+Backslash'],
  ['Ctrl+Shift+0', 'Control+Shift+Digit0'], ['Ctrl+Shift+S', 'Control+Shift+KeyS'],
  ['Ctrl+Alt+S', 'Control+Alt+KeyS'], ['Ctrl+Shift+F', 'Control+Shift+KeyF'],
  ['Ctrl+Shift+B', 'Control+Shift+KeyB'], ['Ctrl+P', 'Control+KeyP'], ['Ctrl+N', 'Control+KeyN'],
  ['Ctrl+Shift+I', 'Control+Shift+KeyI'], ['Ctrl+M', 'Control+KeyM'], ['Ctrl+Q', 'Control+KeyQ'],
  ['Ctrl+Tab', 'Control+Tab'], ['Ctrl+Shift+Tab', 'Control+Shift+Tab'], ['Ctrl+Y', 'Control+KeyY'],
  ['Ctrl+Shift+Z', 'Control+Shift+KeyZ'], ['Ctrl+K', 'Control+KeyK'], ['Ctrl+Shift+Invio', 'Control+Shift+Enter'],
  ['Alt+F', 'Alt+KeyF'], ['Ctrl+H', 'Control+KeyH'], ['Ctrl+Shift+V', 'Control+Shift+KeyV'],
  ['Ctrl+Shift+Minus', 'Control+Shift+Minus'], ['Ctrl+Shift+Plus', 'Control+Shift+Equal'],
  ['Ctrl+Numpad0', 'Control+Numpad0'], ['Ctrl+Shift+Numpad0', 'Control+Numpad0'],
];

for (const [scritto, premi] of CASI) {
  test(`«${scritto}»: o si rifiuta, o premuto apre le statistiche`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await apriDocConModuli(page, [WC, SR]);
    await modifica(page, true);
    await page.locator('.ed-module[data-type="word-count"]').click();
    await page.fill('#cfgShortcut', scritto);
    await page.click('#cfgSave');
    await page.waitForTimeout(150);
    if (await page.locator('#cfgShortcut').count()) {
      const msg = (await page.locator('#cfgShortcutTaken').isVisible()) ? await page.locator('#cfgShortcutTaken').innerText()
        : (await page.locator('#cfgShortcutHint').isVisible()) ? await page.locator('#cfgShortcutHint').innerText() : '(nessun avviso!)';
      console.log(`RIFIUTATA ${scritto} → ${msg}`);
      expect(msg).not.toBe('(nessun avviso!)');
      return;
    }
    await modifica(page, false);
    await page.click('#doc');
    await page.keyboard.press(premi);
    await page.waitForTimeout(300);
    const ok = await page.locator('#overlay h3', { hasText: 'Statistiche' }).count();
    console.log(`ACCETTATA ${scritto} premuta ${premi} → ${ok ? 'PARTE' : 'MORTA'}`);
    expect(ok, `${scritto} accettata ma non parte`).toBe(1);
  });
}

test('Ctrl+F data senza Cerca, poi Cerca aggiunto: la scorciatoia muore in silenzio?', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  await modifica(page, true);
  await page.locator('.ed-module[data-type="word-count"]').click();
  await page.fill('#cfgShortcut', 'Ctrl+F');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcut')).toHaveCount(0);
  await modifica(page, false);
  await page.click('#doc');
  await page.keyboard.press('Control+KeyF');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#overlay').evaluate((o) => { o.hidden = true; });
  await page.locator('.ed-cell-empty').first().click();
  await page.screenshot({ path: 'tests/.shots/v545g4-palette.png' });
  await page.locator('.ed-overlay [data-add="search-replace"]').click();
  await page.waitForSelector('.ed-module[data-type="search-replace"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/v545g4-dopo-aggiunta.png' });
  const avviso = await page.evaluate(() => [...document.querySelectorAll('.ed-toast, [class*="toast"]')].map((t) => t.innerText).join(' | '));
  console.log('AVVISO dopo aggiunta Cerca:', avviso || '(nessuno)');
  await page.click('#doc');
  await page.keyboard.press('Control+KeyF');
  await page.waitForTimeout(300);
  const stat = await page.locator('#overlay h3', { hasText: 'Statistiche' }).count();
  console.log('Ctrl+F dopo aggiunta Cerca → statistiche:', stat);
  await modifica(page, true);
  await page.locator('.ed-module[data-type="word-count"]').click();
  console.log('Avviso all\'apertura:', await page.locator('#cfgShortcutTaken').isVisible() ? await page.locator('#cfgShortcutTaken').innerText() : '(nessuno)');
  expect(stat).toBe(1);
});

test('il suggerimento di un avviso è libero davvero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [{ ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } }, COMMENT]);
  await modifica(page, true);
  await page.locator('.ed-module[data-type="comment"]').click();
  const msgs = [];
  for (const sc of ['Alt+F4', 'Alt+Tab', 'Ctrl+Pippo+2', 'Ctrl+Spazioo', 'b', 'Ctrl+S']) {
    await page.fill('#cfgShortcut', sc);
    await page.click('#cfgSave');
    const t = (await page.locator('#cfgShortcutTaken').isVisible()) ? await page.locator('#cfgShortcutTaken').innerText() : await page.locator('#cfgShortcutHint').innerText();
    msgs.push(`${sc} → ${t}`);
  }
  console.log(msgs.join('\n'));
  await page.fill('#cfgShortcut', 'Ctrl+S');
  await page.click('#cfgSave');
  await page.screenshot({ path: 'tests/.shots/v545g4-avviso-chiaro.png' });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/v545g4-avviso-scuro.png' });
  expect(msgs.filter((m) => /per esempio Ctrl\+Shift\+1|es\. Ctrl\+Shift\+1/.test(m))).toEqual([]);
});
