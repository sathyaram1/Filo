// Esplorazione della verifica #893 giro 1.
import { test, expect } from '../../fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';
const WC = { id: 'wc-t', type: 'word-count', cells: [{ x: 0, y: 0 }], data: { count: 'words' } };
const COMMENT = { id: 'c-t', type: 'comment', cells: [{ x: 4, y: 0 }], data: {} };

const lettere = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => [`Key${c}`, c.toLowerCase()]));
const cifre = Object.fromEntries([...'1234567890'].map((d) => [`Digit${d}`, d]));
const US = { ...lettere, ...cifre, Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: '\'', Backquote: '`', Comma: ',', Period: '.', Slash: '/', IntlBackslash: '<' };
const IT = { ...lettere, ...cifre, Minus: '\'', Equal: 'ì', BracketLeft: 'è', BracketRight: '+', Backslash: 'ù',
  Semicolon: 'ò', Quote: 'à', Backquote: '\\', Comma: ',', Period: '.', Slash: '-', IntlBackslash: '<' };

async function tastiera(page, layout) {
  await page.addInitScript((voci) => {
    const mappa = new Map(voci);
    Object.defineProperty(navigator.keyboard, 'getLayoutMap', { configurable: true, value: async () => mappa });
  }, Object.entries(layout));
}
async function sistema(page, plat) {
  await page.addInitScript((p) => {
    let tasti;
    Object.defineProperty(window, 'SN_TASTI', {
      configurable: true,
      get: () => tasti,
      set: (v) => { tasti = v; if (v) { v.piattaforma = () => p; v.suMac = () => p === 'darwin'; } },
    });
  }, plat);
}
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
async function modulo(page, tipo) {
  if (await page.locator('#settingsView').isHidden()) await page.locator('.ed-module[data-type="settings"]').click();
  await page.locator(`.ed-module[data-type="${tipo}"]`).click();
  await expect(page.locator('#cfgShortcut')).toBeVisible();
}
async function esci(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}
async function premi(page, { key, code, modifiers }) {
  const s = await page.context().newCDPSession(page);
  try {
    await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  } finally { await s.detach().catch(() => {}); }
}
const salvata = (page, id) => page.evaluate((mid) => {
  const col = JSON.parse(localStorage.getItem('filo.editor.collection') || '{}');
  const file = (col.files || []).find((f) => f.id === 'file-tasti') || { modules: [] };
  const m = (file.modules || []).find((x) => x.id === mid);
  return m ? { shortcut: m.data.shortcut || '', tasto: m.data.tasto || '' } : null;
}, id);
const schede = (app) => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter((w) => !w.isDestroyed()).length);

test('caso normale: premi, salva, ripremi, togli', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [WC]);
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+KeyK');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+K');
  await page.keyboard.press('Enter');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Shift+K', tasto: 'cs|KeyK' });
  await esci(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+KeyK');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');
  await modulo(page, 'word-count');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+K');
  await page.fill('#cfgShortcut', '');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: '', tasto: '' });
  await esci(page);
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+KeyK');
  await page.waitForTimeout(400);
  await expect(page.locator('#overlay')).toBeHidden();
});

test('tasti di Filo nel campo: nuova scheda, zoom, salto scheda, riapri chiusa', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [WC]);
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.waitForTimeout(500);
  const prima = await schede(app);
  const zoomPrima = await page.evaluate(() => window.devicePixelRatio);
  const esiti = {};
  for (const [k, combo] of [['T', 'Control+KeyT'], ['shiftT', 'Control+Shift+KeyT'], ['=', 'Control+Equal'], ['-', 'Control+Minus'], ['1', 'Control+Digit1'], ['L', 'Control+KeyL'], ['N', 'Control+KeyN'], ['tab', 'Control+Tab'], ['R', 'Control+KeyR'], ['F', 'Control+KeyF'], ['H', 'Control+KeyH'], ['J', 'Control+KeyJ'], ['P', 'Control+KeyP'], ['Z', 'Control+KeyZ'], ['A', 'Control+KeyA'], ['F4', 'Alt+F4'], ['altSin', 'Alt+ArrowLeft']]) {
    await page.keyboard.press(combo);
    await page.waitForTimeout(250);
    esiti[k] = { val: await page.locator('#cfgShortcut').inputValue(), msg: (await page.locator('#cfgShortcutTaken').isVisible()) ? await page.locator('#cfgShortcutTaken').textContent() : '(nessun avviso)' };
  }
  console.log(JSON.stringify(esiti, null, 1));
  expect(page.isClosed()).toBe(false);
  console.log('schede', prima, await schede(app), 'zoom', zoomPrima, await page.evaluate(() => window.devicePixelRatio), page.url());
  await page.screenshot({ path: 'tests/.shots/v893-filo-nel-campo.png' });
});

test('Esc dopo una pressione: niente salvato, Ctrl+Z torna come prima', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [WC]);
  const ctrlZ = await page.evaluate(() => document.documentElement.dataset.filoCtrlZ ?? '(assente)');
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+KeyK');
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  expect(await salvata(page, 'wc-t')).toEqual({ shortcut: '', tasto: '' });
  expect(await page.evaluate(() => document.documentElement.dataset.filoCtrlZ ?? '(assente)')).toBe(ctrlZ);
  // apri e chiudi in fretta, clic fuori
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.mouse.click(5, 5);
  await page.waitForTimeout(200);
  console.log('dopo clic fuori, overlay hidden:', await page.locator('#overlay').isHidden(), 'ctrlZ', await page.evaluate(() => document.documentElement.dataset.filoCtrlZ ?? '(assente)'));
});

test('stesso tasto su due moduli, scritto in minuscolo e premuto', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, IT);
  await sistema(page, 'win32');
  await apriDocConModuli(page, [WC, COMMENT]);
  await modulo(page, 'word-count');
  await page.fill('#cfgShortcut', 'ctrl+alt+k');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  console.log('salvata', JSON.stringify(await salvata(page, 'wc-t')));
  await modulo(page, 'comment');
  await page.locator('#cfgShortcut').click();
  await premi(page, { key: 'k', code: 'KeyK', modifiers: 1 | 2 });
  console.log('comment premuto:', await page.locator('#cfgShortcut').inputValue(), '|', await page.locator('#cfgShortcutTaken').textContent());
  await page.click('#cfgCancel');
  // AltGr+E scrive € nel documento: con Ctrl+Alt+E su un modulo?
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await premi(page, { key: '€', code: 'KeyE', modifiers: 1 | 2 });
  console.log('Ctrl+Alt+E premuto:', await page.locator('#cfgShortcut').inputValue(), '| avviso visibile:', await page.locator('#cfgShortcutTaken').isVisible());
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await esci(page);
  await page.click('#doc');
  await premi(page, { key: '€', code: 'KeyE', modifiers: 1 | 2 });
  await page.waitForTimeout(400);
  console.log('scrivendo € nel documento si apre:', await page.locator('#overlay').isVisible() ? await page.locator('#overlay h3').textContent() : '(niente)');
});

test('aspetto: rifiuto e nota, chiaro e scuro, e Mac', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [WC, { ...COMMENT, data: { shortcut: 'Ctrl+!' } }]);
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await modulo(page, 'comment');
    await page.screenshot({ path: `tests/.shots/v893-nota-${tema}.png` });
    await page.locator('#cfgShortcut').click();
    await page.keyboard.press('Control+Shift');
    await page.keyboard.down('Control');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(150);
    console.log('attesa:', await page.locator('#cfgShortcut').inputValue());
    await page.screenshot({ path: `tests/.shots/v893-attesa-${tema}.png` });
    await page.keyboard.up('Shift');
    await page.keyboard.up('Control');
    console.log('rilasciati:', await page.locator('#cfgShortcut').inputValue());
    await page.keyboard.press('Control+KeyW');
    await page.screenshot({ path: `tests/.shots/v893-rifiuto-${tema}.png` });
    await page.click('#cfgCancel');
    await esci(page);
  }
});

test('senza tastiera nota: premere e scrivere', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await page.addInitScript(() => { Object.defineProperty(navigator.keyboard, 'getLayoutMap', { configurable: true, value: async () => { throw new Error('no'); } }); });
  await apriDocConModuli(page, [WC, { ...COMMENT, data: { shortcut: 'Ctrl+Shift+J' } }]);
  await page.waitForTimeout(500);
  console.log('testo vecchio senza tastiera:', JSON.stringify(await salvata(page, 'c-t')));
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+KeyJ');
  await page.waitForTimeout(300);
  console.log('commento avviato?', await page.evaluate(() => document.body.className), await page.locator('#overlay').isVisible());
  await page.keyboard.press('Escape');
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+KeyK');
  console.log('premuto senza tastiera:', await page.locator('#cfgShortcut').inputValue());
  await page.fill('#cfgShortcut', 'Ctrl+Shift+J');
  await page.click('#cfgSave');
  console.log('scritto uguale al commento:', await page.locator('#overlay').isVisible() ? await page.locator('#cfgShortcutTaken').textContent() : 'salvato');
});
