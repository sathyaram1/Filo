// Una combinazione di tasti come la scrive chi pilota Filo («Ctrl+W», «Control+t», «Cmd+Shift+T», «Esc») → il nome che
// vuole Playwright e l'`input` di before-input-event, dove Filo ascolta le scorciatoie della finestra (driver.mjs).
// PURA. Prove: tests/unit/provaDaUtente.test.mjs.

const MODIFICATORI = {
  control: 'control', ctrl: 'control', ctl: 'control',
  meta: 'meta', cmd: 'meta', command: 'meta', super: 'meta', win: 'meta',
  alt: 'alt', option: 'alt', opt: 'alt', altgr: 'alt',
  shift: 'shift', maiusc: 'shift',
};
// «Il Ctrl di questo sistema»: Cmd su Mac, Ctrl altrove (CLAUDE.md § Mac e Linux).
const CTRL_O_CMD = new Set(['controlormeta', 'commandorcontrol', 'cmdorctrl', 'ctrlorcmd', 'mod']);
const NOMI_PLAYWRIGHT = { control: 'Control', meta: 'Meta', alt: 'Alt', shift: 'Shift' };

const NOMI = {
  enter: 'Enter', return: 'Enter', invio: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab',
  space: 'Space', spacebar: 'Space', spazio: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', canc: 'Delete',
  home: 'Home', end: 'End', fine: 'End', pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown',
  insert: 'Insert', ins: 'Insert',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  plus: '+', minus: '-', meno: '-', piu: '+', più: '+',
};
const CODICI_SEGNI = {
  '-': 'Minus', '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ',': 'Comma',
  '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote',
};

/**
 * `testo` → { ok, playwright, input: { key, code, control, shift, alt, meta } } o { ok: false, errore }. Un nome di
 * tasto che non conosce passa com'è: lo giudica Playwright. `piattaforma` decide «CmdOrCtrl».
 */
export function leggiTasto(testo, piattaforma = process.platform) {
  const t = String(testo || '').trim();
  if (!t) return { ok: false, errore: 'tasto vuoto' };
  let parti;
  let tasto;
  if (t.length > 1 && t.endsWith('++')) { parti = t.slice(0, -2).split('+'); tasto = '+'; }
  else { parti = t.split('+'); tasto = parti.pop(); }
  tasto = tasto.trim();
  if (!tasto) return { ok: false, errore: `nella combinazione «${t}» manca il tasto` };
  const mod = { control: false, shift: false, alt: false, meta: false };
  for (const p of parti.map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const m = CTRL_O_CMD.has(p) ? (piattaforma === 'darwin' ? 'meta' : 'control') : MODIFICATORI[p];
    if (!m) return { ok: false, errore: `«${p}» non è un modificatore (Control, Shift, Alt, Meta)` };
    mod[m] = true;
  }
  const nome = NOMI[tasto.toLowerCase()] || (/^f([1-9]|1[0-9]|2[0-4])$/i.test(tasto) ? tasto.toUpperCase() : tasto);
  const lettera = /^[a-z]$/i.test(nome);
  const cifra = /^[0-9]$/.test(nome);
  const key = lettera ? (mod.shift ? nome.toUpperCase() : nome.toLowerCase()) : nome === 'Space' ? ' ' : nome;
  const code = lettera ? `Key${nome.toUpperCase()}` : cifra ? `Digit${nome}` : CODICI_SEGNI[nome] || nome;
  const playwright = [...Object.keys(NOMI_PLAYWRIGHT).filter((m) => mod[m]).map((m) => NOMI_PLAYWRIGHT[m]), nome].join('+');
  return { ok: true, playwright, input: { key, code, ...mod } };
}
