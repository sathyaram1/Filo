// Verifica #893 giro 1, rilievo 2: su Windows una combinazione che con AltGr scrive un carattere non si salva in silenzio.
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

test('r2 Ctrl+Alt+E su tastiera italiana: Filo avvisa che toglie il simbolo € al foglio', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, IT);
  await sistema(page, 'win32');
  await apriDocConModuli(page, [WC]);
  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await premi(page, { key: '€', code: 'KeyE', modifiers: 1 | 2 });
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Alt+E');
  await expect(page.locator('#cfgShortcutTaken, #cfgShortcutNota').filter({ hasText: '€' })).toBeVisible();
});
