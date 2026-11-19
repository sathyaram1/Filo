// Una combinazione di tasti come la scrive chi pilota Filo («Ctrl+W», «Controllo+T», «Cmd+Shift+T», «Esc») → il nome che
// vuole Playwright e l'`input` di before-input-event (driver.mjs). La legge il lettore di Filo (SN_TASTI.letturaScritta):
// qui si traducono solo i nomi. PURA. Prove: tests/unit/provaDaUtente.test.mjs.

import { createRequire } from 'node:module';

createRequire(import.meta.url)('../../src/shared/tasti.js');
const T = globalThis.SN_TASTI;

// I nomi di Electron per «il Ctrl di questo sistema»: per Filo Ctrl scritto è già Cmd su Mac.
const CTRL_O_CMD = /^(controlormeta|commandorcontrol|cmdorctrl|ctrlorcmd|mod)$/i;
// Il tasto canonico di Filo → il nome del DOM, che usano Playwright ed Electron.
const NOMI_DOM = {
  space: 'Space', enter: 'Enter', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', contextmenu: 'ContextMenu', pause: 'Pause',
  printscreen: 'PrintScreen', '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown',
};
const CODICI_SEGNI = {
  '-': 'Minus', '=': 'Equal', '+': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ',': 'Comma',
  '.': 'Period', '/': 'Slash', ';': 'Semicolon', "'": 'Quote', '`': 'Backquote',
};

/**
 * `testo` → { ok, playwright, input: { key, code, control, shift, alt, meta } } o { ok: false, errore }. Un nome di
 * tasto che Filo non conosce passa com'è: lo giudica Playwright. `piattaforma` decide dove Ctrl scritto è Cmd.
 */
export function leggiTasto(testo, piattaforma = process.platform) {
  const grezzo = String(testo || '').trim();
  if (!grezzo) return { ok: false, errore: 'tasto vuoto' };
  const t = grezzo === '+' ? 'Plus' : grezzo.split('+').map((p) => (CTRL_O_CMD.test(p.trim()) ? 'Ctrl' : p)).join('+');
  if (T.soloModificatori(t)) return { ok: false, errore: `nella combinazione «${grezzo}» manca il tasto` };
  const ignoto = T.pezzoSconosciuto(t);
  if (ignoto && ignoto.modificatore) return { ok: false, errore: `«${ignoto.nome}» non è un modificatore (Control, Shift, Alt, Meta)` };
  const l = T.letturaScritta(t);
  if (!l) return { ok: false, errore: `«${grezzo}» non si legge come una combinazione` };
  const mac = piattaforma === 'darwin';
  const mod = { control: l.ctrl && (!mac || l.cmdECtrl), shift: l.shift, alt: l.alt, meta: l.ctrl && (mac || l.cmdECtrl) };
  const c = l.tasto;
  const lettera = /^[a-z]$/.test(c);
  const cifra = /^[0-9]$/.test(c);
  const funzione = /^f([1-9]|1[0-9]|2[0-4])$/.test(c);
  // Un nome che Filo non riconosce (MediaPlayPause) resta scritto com'era.
  const nome = NOMI_DOM[c] || (funzione ? c.toUpperCase() : [...c].length === 1 ? c : l.scritto);
  const key = lettera ? (mod.shift ? c.toUpperCase() : c) : nome === 'Space' ? ' ' : nome;
  const code = lettera ? `Key${c.toUpperCase()}` : cifra ? `Digit${c}` : CODICI_SEGNI[c] || nome;
  const playwright = [mod.control && 'Control', mod.meta && 'Meta', mod.alt && 'Alt', mod.shift && 'Shift', lettera ? key : nome].filter(Boolean).join('+');
  return { ok: true, playwright, input: { key, code, ...mod } };
}
