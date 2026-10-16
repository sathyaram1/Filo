// #893: la scorciatoia di un modulo dell'Editor si registra premendo i tasti e si salva come tasto fisico.
// Le tastiere si simulano: getLayoutMap finto, e gli eventi col key e il code che quella tastiera produce.
// Le regole stanno in src/shared/tasti.js (tests/unit/tastoFisico.test.mjs); qui i passi dell'utente.
import { test, expect } from './fixtures/electron.mjs';

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

async function esciDalleImpostazioni(page) {
  await page.locator('.ed-module[data-type="settings"]').click();
  await expect(page.locator('#settingsView')).toBeHidden();
}

// Un tasto come lo manda quella tastiera: key e code scelti, modificatori Alt=1, Ctrl=2, Meta=4, Shift=8.
async function premi(page, { key, code, modifiers }) {
  const s = await page.context().newCDPSession(page);
  try {
    await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  } finally { await s.detach().catch(() => {}); }
}

const salvata = (page, id) => page.evaluate((mid) => {
  const col = JSON.parse(localStorage.getItem('filo.editor.collection') || '{}');
  const m = ((col.files || [])[0] || { modules: [] }).modules.find((x) => x.id === mid);
  return m ? { shortcut: m.data.shortcut || '', tasto: m.data.tasto || '' } : null;
}, id);

for (const [nome, layout] of [['americana', US], ['italiana', IT]]) {
  test(`tastiera ${nome}: Ctrl+! e Ctrl+Shift+1 sono un tasto solo, e un secondo modulo non lo prende`, async ({ openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await tastiera(page, layout);
    await apriDocConModuli(page, [WC, COMMENT]);

    // Ctrl+! sulla tastiera si preme con Shift+1: il campo mostra il tasto, non il carattere.
    await modulo(page, 'word-count');
    await page.locator('#cfgShortcut').click();
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+1');
    await page.click('#cfgSave');
    await expect(page.locator('#overlay')).toBeHidden();
    await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });

    // Scritto col nome, è lo stesso tasto: il secondo salvataggio si rifiuta e nomina il primo modulo.
    await modulo(page, 'comment');
    await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('«Conteggio parole»');
    // Scritto col simbolo, «!» non ha un tasto suo: Filo chiede di premerlo.
    await page.fill('#cfgShortcut', 'Ctrl+!');
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('premi la combinazione');
    // Premuto, il rifiuto arriva subito.
    await page.locator('#cfgShortcut').click();
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('«Conteggio parole»');
    await page.screenshot({ path: `tests/.shots/editor-tasto-fisico-preso-${nome}.png` });
    await page.click('#cfgCancel');

    await esciDalleImpostazioni(page);
    await page.click('#doc');
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  });
}

test('Windows, tastiera italiana: Ctrl+@ registrato con AltGr+ò parte quando si ripreme', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, IT);
  await sistema(page, 'win32');
  await apriDocConModuli(page, [WC]);
  const altGrO = { key: '@', code: 'Semicolon', modifiers: 1 | 2 };

  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await premi(page, altGrO);
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Alt+ò');
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Alt+ò', tasto: 'ca|Semicolon' });

  await esciDalleImpostazioni(page);
  await page.click('#doc');
  await premi(page, altGrO);
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();

  // Scritto a mano «@» non ha un tasto suo: lo si preme.
  await page.click('#cfgCancel').catch(() => {});
  await page.keyboard.press('Escape');
  await modulo(page, 'word-count');
  await page.fill('#cfgShortcut', 'Ctrl+@');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('«@» non ha un tasto suo');
});

test('tastiera francese: Ctrl+6 scrive il meno, ed è lo zoom del foglio', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, FR);
  await apriDocConModuli(page, [WC]);

  await modulo(page, 'word-count');
  await page.fill('#cfgShortcut', 'Ctrl+6');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('zooma il foglio');
  await expect(page.locator('#overlay')).toBeVisible();

  await page.fill('#cfgShortcut', '');
  await page.locator('#cfgShortcut').click();
  await premi(page, { key: '-', code: 'Digit6', modifiers: 2 });
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+6');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('zooma il foglio');

  // Sulla AZERTY la A sta dove la QWERTY ha la Q: scritta, la lettera va sul tasto che la scrive.
  await page.fill('#cfgShortcut', 'Ctrl+Shift+A');
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Shift+A', tasto: 'cs|KeyQ' });
});

test('una scorciatoia salvata come testo si lega al tasto all\'apertura e parte ancora', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConModuli(page, [
    { ...WC, data: { count: 'words', shortcut: 'Ctrl+Shift+1' } },
    { ...COMMENT, data: { shortcut: 'Ctrl+!' } },
  ]);
  await expect.poll(() => salvata(page, 'wc-t')).toEqual({ shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });
  // «!» non ha un tasto suo: resta com'era, e il suo pannello lo dice.
  expect(await salvata(page, 'c-t')).toEqual({ shortcut: 'Ctrl+!', tasto: '' });

  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');

  await modulo(page, 'comment');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+!');
  await expect(page.locator('#cfgShortcutNota')).toContainText('premi la combinazione per fissarla');
  await page.screenshot({ path: 'tests/.shots/editor-tasto-fisico-testo.png' });
});

test('su Mac Cmd+Shift+1 registrato si mostra col nome del Mac, e Control da solo si rifiuta', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await sistema(page, 'darwin');
  await apriDocConModuli(page, [WC]);
  const atteso = await page.evaluate(() => window.SN_TASTI.etichetta('Ctrl+Shift+1', 'darwin'));
  expect(atteso).toBe('Cmd+Shift+1');

  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('non con Control');
  await page.keyboard.press('Meta+Shift+Digit1');
  await expect(page.locator('#cfgShortcut')).toHaveValue(atteso);
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();

  await esciDalleImpostazioni(page);
  await page.click('#doc');
  await page.keyboard.press('Meta+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

test('nel campo Ctrl+W non chiude la scheda: si registra e si rifiuta dicendo di chi è', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConModuli(page, [WC]);
  const registra = () => app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .some((w) => w._filoRegistraTastiFino && w._filoRegistraTastiFino > Date.now()));

  await modulo(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await expect.poll(registra).toBe(true);
  await page.keyboard.press('Control+KeyW');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+W');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('chiude la scheda');
  expect(page.isClosed()).toBe(false);
  await page.screenshot({ path: 'tests/.shots/editor-tasto-fisico-ctrl-w.png' });

  // Le lettere si scrivono: a mano la scorciatoia si scrive ancora.
  await page.fill('#cfgShortcut', '');
  await page.locator('#cfgShortcut').pressSequentially('Ctrl+Shift+K');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+K');

  // Esc chiude il pannello e il main torna a prendersi i suoi tasti.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(registra).toBe(false);
});
