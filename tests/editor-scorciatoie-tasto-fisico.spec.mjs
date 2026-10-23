// #893: la scorciatoia di uno strumento dell'Editor si registra premendo i tasti e si salva come tasto fisico, nelle
// regolazioni che il main conserva per il pannello (#1433). Le tastiere si simulano: getLayoutMap finto, e gli eventi
// col key e il code che quella tastiera produce. Le regole stanno in src/shared/tasti.js (tests/unit/tastoFisico.test.mjs).
import { test, expect } from './fixtures/electron.mjs';
import { EDITOR, apriDocConStrumenti, apriImpostazioni, strumentiSalvati } from './helpers/strumentiEditor.mjs';

const WC = 'word-count';
const COMMENT = 'comment';

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

async function impostazioni(page, id) {
  await apriImpostazioni(page, id);
  await expect(page.locator('#cfgShortcut')).toBeVisible();
}

// Un tasto come lo manda quella tastiera: key e code scelti, modificatori Alt=1, Ctrl=2, Meta=4, Shift=8.
async function premi(page, { key, code, modifiers }) {
  const s = await page.context().newCDPSession(page);
  try {
    await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
  } finally { await s.detach().catch(() => {}); }
}

const salvata = async (app, id) => {
  const c = ((await strumentiSalvati(app)) || { config: {} }).config[id] || {};
  return { shortcut: c.shortcut || '', tasto: c.tasto || '' };
};

for (const [nome, layout] of [['americana', US], ['italiana', IT]]) {
  test(`tastiera ${nome}: Ctrl+! e Ctrl+Shift+1 sono un tasto solo, e un secondo strumento non lo prende`, async ({ app, openTab }) => {
    const page = await openTab(EDITOR);
    await page.waitForLoadState('domcontentloaded');
    await tastiera(page, layout);
    await apriDocConStrumenti(app, page, [WC, COMMENT]);

    // Ctrl+! sulla tastiera si preme con Shift+1: il campo mostra il tasto, non il carattere.
    await impostazioni(page, 'word-count');
    await page.locator('#cfgShortcut').click();
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+1');
    await page.click('#cfgSave');
    await expect(page.locator('#overlay')).toBeHidden();
    await expect.poll(() => salvata(app, WC)).toEqual({ shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });

    // Scritto col nome, è lo stesso tasto: il secondo salvataggio si rifiuta e nomina il primo strumento.
    await impostazioni(page, 'comment');
    await page.fill('#cfgShortcut', 'Ctrl+Shift+1');
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('«Conteggio»');
    // Scritto col simbolo, «!» non ha un tasto suo: Filo chiede di premerlo.
    await page.fill('#cfgShortcut', 'Ctrl+!');
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('premi la combinazione');
    // Premuto, il rifiuto arriva subito.
    await page.locator('#cfgShortcut').click();
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('«Conteggio»');
    await page.screenshot({ path: `tests/.shots/editor-tasto-fisico-preso-${nome}.png` });
    await page.click('#cfgCancel');

    await page.click('#doc');
    await page.keyboard.press('Control+Shift+Digit1');
    await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  });
}

test('Windows, tastiera italiana: Ctrl+@ registrato con AltGr+ò parte quando si ripreme', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, IT);
  await sistema(page, 'win32');
  await apriDocConStrumenti(app, page, [WC]);
  const altGrO = { key: '@', code: 'Semicolon', modifiers: 1 | 2 };

  await impostazioni(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await premi(page, altGrO);
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Alt+ò');
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(app, WC)).toEqual({ shortcut: 'Ctrl+Alt+ò', tasto: 'ca|Semicolon' });

  await page.click('#doc');
  await premi(page, altGrO);
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();

  // Scritto a mano «@» non ha un tasto suo: lo si preme.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  await impostazioni(page, 'word-count');
  await page.fill('#cfgShortcut', 'Ctrl+@');
  await page.click('#cfgSave');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('«@» non ha un tasto suo');
});

test('tastiera francese: Ctrl+6 scrive il meno, ed è lo zoom del foglio', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, FR);
  await apriDocConStrumenti(app, page, [WC]);

  await impostazioni(page, 'word-count');
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
  await expect.poll(() => salvata(app, WC)).toEqual({ shortcut: 'Ctrl+Shift+A', tasto: 'cs|KeyQ' });
});

test('una scorciatoia salvata come testo si lega al tasto all\'apertura e parte ancora', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConStrumenti(app, page, [WC, COMMENT], { [WC]: { shortcut: 'Ctrl+Shift+1' }, [COMMENT]: { shortcut: 'Ctrl+!' } });
  await expect.poll(() => salvata(app, WC)).toEqual({ shortcut: 'Ctrl+Shift+1', tasto: 'cs|Digit1' });
  // «!» non ha un tasto suo: resta com'era, e le sue regolazioni lo dicono.
  expect(await salvata(app, COMMENT)).toEqual({ shortcut: 'Ctrl+!', tasto: '' });

  await page.click('#doc');
  await page.keyboard.press('Control+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
  await page.keyboard.press('Escape');

  await impostazioni(page, 'comment');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+!');
  await expect(page.locator('#cfgShortcutNota')).toContainText('premi la combinazione per fissarla');
  await page.screenshot({ path: 'tests/.shots/editor-tasto-fisico-testo.png' });
});

test('su Mac Cmd+Shift+1 registrato si mostra col nome del Mac, e Control da solo si rifiuta', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await sistema(page, 'darwin');
  await apriDocConStrumenti(app, page, [WC]);
  const atteso = await page.evaluate(() => window.SN_TASTI.etichetta('Ctrl+Shift+1', 'darwin'));
  expect(atteso).toBe('Cmd+Shift+1');

  await impostazioni(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await page.keyboard.press('Control+Shift+Digit2');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('non con Control');
  await page.keyboard.press('Meta+Shift+Digit1');
  await expect(page.locator('#cfgShortcut')).toHaveValue(atteso);
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();

  await page.click('#doc');
  await page.keyboard.press('Meta+Shift+Digit1');
  await expect(page.locator('#overlay h3', { hasText: 'Statistiche' })).toBeVisible();
});

test('nel campo Ctrl+W non chiude la scheda: si registra e si rifiuta dicendo di chi è', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await apriDocConStrumenti(app, page, [WC]);
  const registra = () => app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .some((w) => w._filoRegistraTastiFino && w._filoRegistraTastiFino > Date.now()));

  await impostazioni(page, 'word-count');
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

  // Esc chiude il riquadro e il main torna a prendersi i suoi tasti.
  await page.keyboard.press('Escape');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(registra).toBe(false);
});

test('una combinazione premuta si toglie con Backspace, anche dopo Ctrl+A', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await apriDocConStrumenti(app, page, [WC], { [WC]: { shortcut: 'Ctrl+Shift+K', tasto: 'cs|KeyK' } });

  await impostazioni(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  // Quella salvata è un pezzo solo: Canc la toglie, e salvando lo strumento resta senza.
  await page.keyboard.press('Delete');
  await expect(page.locator('#cfgShortcut')).toHaveValue('');
  await page.keyboard.press('Control+Shift+KeyJ');
  await expect(page.locator('#cfgShortcut')).toHaveValue('Ctrl+Shift+J');
  await page.keyboard.press('Control+KeyA');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('seleziona tutto');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#cfgShortcut')).toHaveValue('');
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
  await page.click('#cfgSave');
  await expect(page.locator('#overlay')).toBeHidden();
  await expect.poll(() => salvata(app, WC)).toEqual({ shortcut: '', tasto: '' });
});

test('i tasti con cui si scrive nel foglio non vanno a uno strumento', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  // Salvata prima di questo controllo: le regolazioni lo dicono, e nel foglio il tasto cancella la parola.
  await apriDocConStrumenti(app, page, [WC], { [WC]: { shortcut: 'Ctrl+Backspace', tasto: 'c|Backspace' } });
  await page.click('#doc');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Backspace');
  await expect(page.locator('#doc')).toHaveText('ciao ');
  await expect(page.locator('#overlay')).toBeHidden();

  await impostazioni(page, 'word-count');
  await expect(page.locator('#cfgShortcutTaken')).toContainText('cancellare e a muoversi nel testo');
  await page.locator('#cfgShortcut').click();
  for (const [premuta, nome] of [['Control+Delete', 'Ctrl+Canc'], ['Control+ArrowLeft', 'Ctrl+←'], ['Control+Shift+ArrowRight', 'Ctrl+Shift+→'], ['Control+End', 'Ctrl+Fine']]) {
    await page.keyboard.press(premuta);
    await expect(page.locator('#cfgShortcut')).toHaveValue(nome);
    await expect(page.locator('#cfgShortcutTaken')).toContainText('cancellare e a muoversi nel testo');
  }
  for (const scritta of ['Ctrl+Backspace', 'Ctrl+Inizio', 'ctrl+shift+sinistra']) {
    await page.fill('#cfgShortcut', scritta);
    await page.click('#cfgSave');
    await expect(page.locator('#cfgShortcutTaken')).toContainText('cancellare e a muoversi nel testo');
  }
  await expect(page.locator('#overlay')).toBeVisible();
});

test('su Mac Opzione+Backspace e Cmd+freccia restano al testo', async ({ app, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForLoadState('domcontentloaded');
  await tastiera(page, US);
  await sistema(page, 'darwin');
  await apriDocConStrumenti(app, page, [WC]);
  await impostazioni(page, 'word-count');
  await page.locator('#cfgShortcut').click();
  await premi(page, { key: 'Backspace', code: 'Backspace', modifiers: 1 });
  await expect(page.locator('#cfgShortcutTaken')).toContainText('cancellare e a muoversi nel testo');
  await premi(page, { key: 'ArrowDown', code: 'ArrowDown', modifiers: 4 | 8 });
  await expect(page.locator('#cfgShortcutTaken')).toContainText('cancellare e a muoversi nel testo');
  // Una lettera con Opzione resta libera.
  await premi(page, { key: '˚', code: 'KeyK', modifiers: 1 });
  await expect(page.locator('#cfgShortcutTaken')).toBeHidden();
});
