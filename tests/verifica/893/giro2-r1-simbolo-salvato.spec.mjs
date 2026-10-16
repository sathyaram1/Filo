// Verifica #893 giro 2, rilievo 1: una scorciatoia vecchia scritta col simbolo («Ctrl+!») e una legata al tasto
// (Ctrl+Shift+1) sono lo stesso tasto, ma Filo non lo vede: partirebbe solo una delle due, senza avvisi.
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
const FR = { ...lettere, KeyQ: 'a', KeyA: 'q', KeyW: 'z', KeyZ: 'w', KeyM: ',', Semicolon: 'm',
  Digit1: '&', Digit2: 'é', Digit3: '"', Digit4: '\'', Digit5: '(', Digit6: '-', Digit7: 'è', Digit8: '_', Digit9: 'ç', Digit0: 'à',
  Minus: ')', Equal: '=', BracketLeft: '^', BracketRight: '$', Backslash: '*', Quote: 'ù', Backquote: '²',
  Comma: ';', Period: ':', Slash: '!', IntlBackslash: '<' };

async function tastiera(page, layout) {
  await page.addInitScript((voci) => {
    const mappa = new Map(voci);
    Object.defineProperty(navigator.keyboard, 'getLayoutMap', { configurable: true, value: async () => mappa });
  }, Object.entries(layout));
}

// L'Editor chiede il sistema a SN_TASTI.piattaforma() e lo passa alle regole: basta cambiare quella.
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
const salvata = (page, id) => page.evaluate((mid) => {
  const col = JSON.parse(localStorage.getItem('filo.editor.collection') || '{}');
  const file = (col.files || []).find((f) => f.id === 'file-tasti') || { modules: [] };
  const m = (file.modules || []).find((x) => x.id === mid);
  return m ? { shortcut: m.data.shortcut || '', tasto: m.data.tasto || '' } : null;
}, id);


test('r1 salvate prima del lavoro, Ctrl+! e Ctrl+Shift+1: il pannello del commento dice che il tasto è del conteggio', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [
    { ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } },
    { ...COMMENT, data: { shortcut: 'Ctrl+!' } },
  ]);
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });
  // Nel foglio Ctrl+Shift+1 apre le statistiche: il commento non parte.
  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');

  await modulo(page, 'comment');
  await expect(page.locator('#overlay .ed-field').first()).toContainText('«Conteggio parole»');
});

test('r1 Ctrl+! salvato prima sul commento: Ctrl+Shift+1 scritto sul conteggio si rifiuta e nomina il commento', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [{ ...COMMENT, data: { shortcut: 'Ctrl+!' } }, WC]);
  await modulo(page, 'word-count');
  await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('«Commenta»');
  await expect(page.locator('#overlay')).toBeVisible();
});
