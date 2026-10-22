// #842: le scorciatoie di Spiega, Traduci, Salva per dopo e Aiuto le sceglie l'utente. Una regola sola (SN_TASTI)
// legge la combinazione premuta o detta, la rifiuta col motivo, la fa scattare e la nomina; la vecchia si libera.
// Chiude anche #545.5: Ctrl+Shift+T, W, L e R li prende Filo, quindi non si danno a un modulo dell'Editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;
for (const f of ['constants.js', 'tasti.js', 'preferences.js', 'cambi.js', 'voceChat.js']) require(join(ROOT, 'src', 'shared', f));
const T = globalThis.SN_TASTI;
const P = globalThis.SN_PREF;
const { comandoDaTasto, configura } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));

const tasto = (key, mods = {}, altro = {}) => ({
  type: 'keyDown', key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '',
  alt: false, control: false, meta: false, shift: false, ...mods, ...altro,
});
const conScelta = (mappa, fn) => { try { T.usaScorciatoieFilo(mappa); return fn(); } finally { T.usaScorciatoieFilo({}); } };

test('di serie sono Alt+E, Alt+T, Alt+S e Alt+H; una scelta illeggibile vale quella di serie', () => {
  assert.deepEqual(T.AZIONI_FILO.map((a) => a.serie), ['Alt+E', 'Alt+T', 'Alt+S', 'Alt+H']);
  conScelta({ 'explain-selection': 'Ctrl+Pippo', 'translate-selection': 42, 'save-for-later': 'K', 'open-help-sidebar': '' }, () => {
    for (const a of T.AZIONI_FILO) assert.equal(T.scorciatoiaFilo(a.id), a.serie, a.id);
  });
  assert.equal(T.scorciatoiaFilo('inventata'), '');
});

test('cambiata Traduci, scatta la nuova su ogni sistema e la vecchia non fa più niente', () => {
  configura({ scorciatoie: { 'translate-selection': 'Ctrl+Shift+Y' } });
  try {
    const nuova = tasto('Y', { control: true, shift: true });
    assert.equal(comandoDaTasto(nuova, 'win32'), 'translate-selection');
    assert.equal(comandoDaTasto(nuova, 'linux'), 'translate-selection');
    // Su Mac Ctrl si preme Cmd, e il tasto Control da solo non è quella combinazione.
    assert.equal(comandoDaTasto(tasto('Y', { meta: true, shift: true }), 'darwin'), 'translate-selection');
    assert.equal(comandoDaTasto(nuova, 'darwin'), null);
    for (const sistema of ['win32', 'linux']) assert.equal(comandoDaTasto(tasto('t', { alt: true }), sistema), null, sistema);
    assert.equal(comandoDaTasto(tasto('t', { alt: true, control: true }), 'darwin'), null);
    // Le altre tre restano dove erano.
    assert.equal(comandoDaTasto(tasto('e', { alt: true }), 'win32'), 'explain-selection');
    // Shift in più o in meno è un'altra combinazione.
    assert.equal(comandoDaTasto(tasto('y', { control: true }), 'win32'), null);
    assert.equal(comandoDaTasto({ ...nuova, type: 'keyUp' }, 'win32'), null);
  } finally {
    configura({});
  }
});

test('il nome segue la scelta: su Mac dice i tasti veri', () => {
  conScelta({ 'translate-selection': 'Ctrl+Shift+Y', 'open-help-sidebar': 'Alt+Shift+K' }, () => {
    const nomi = (s) => Object.fromEntries(T.scorciatoieFilo(s).map((x) => [x.id, x.etichetta]));
    assert.deepEqual(nomi('win32'), {
      'explain-selection': 'Alt+E', 'translate-selection': 'Ctrl+Shift+Y', 'save-for-later': 'Alt+S', 'open-help-sidebar': 'Alt+Shift+K',
    });
    assert.deepEqual(nomi('darwin'), {
      'explain-selection': 'Ctrl+Alt+E', 'translate-selection': 'Cmd+Shift+Y', 'save-for-later': 'Ctrl+Alt+S', 'open-help-sidebar': 'Ctrl+Alt+Shift+K',
    });
    // Il nome che il Mac legge è quello che fa scattare l'azione.
    assert.equal(comandoDaTasto(tasto('K', { control: true, alt: true, shift: true }), 'darwin'), 'open-help-sidebar');
    assert.equal(T.scorciatoieFilo('win32').find((x) => x.id === 'translate-selection').diSerie, false);
  });
});

test('i tasti presi da Filo seguono la scelta: la vecchia si libera, la nuova è presa', () => {
  conScelta({ 'translate-selection': 'Ctrl+Shift+Y' }, () => {
    for (const s of ['win32', 'linux', 'darwin']) {
      assert.equal(T.riservato(s === 'darwin' ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y', s), true, s);
      assert.equal(T.riservato('Ctrl+Shift+Y', s), true, s);
    }
    assert.equal(T.riservato('Alt+T', 'win32'), false, 'Alt+T è tornato libero per un modulo');
    assert.equal(T.rifiutoScritta('Alt+T', 'win32'), null);
    assert.equal(T.rifiutoScritta('Ctrl+Shift+Y', 'win32').tipo, 'presa');
  });
});

test('#545.5: Ctrl+Shift+T, W, L e R sono di Filo come senza Shift, su ogni sistema', () => {
  for (const s of ['win32', 'linux', 'darwin']) {
    for (const l of ['T', 'W', 'L', 'R']) {
      const scritta = s === 'darwin' ? `Cmd+Shift+${l}` : `Ctrl+Shift+${l}`;
      assert.equal(T.riservato(scritta, s), true, `${scritta} su ${s}`);
      const r = T.rifiutoScritta(scritta, s);
      assert.equal(r && r.tipo, 'presa', `${scritta} su ${s}`);
      assert.ok(r.cosa, 'il rifiuto dice cosa fa quel tasto');
    }
  }
  // #1476: con Shift riapre l'ultima scheda chiusa, come nei browser.
  assert.match(T.chiLaPrende('Ctrl+Shift+T', 'win32'), /riapre l'ultima scheda chiusa/);
  assert.match(T.chiLaPrende('Cmd+Shift+T', 'darwin'), /riapre l'ultima scheda chiusa/);
});

const rifiuto = (id, scritta, sistema = 'win32') => {
  const d = T.scorciatoiaDaScritta(scritta, sistema);
  const r = d.rifiuto || T.rifiutoScorciatoiaFilo(id, d.accel, sistema);
  return r ? T.testoRifiutoFilo(r, sistema) : '';
};

test('una combinazione presa, del sistema o di un\'altra azione si rifiuta col motivo', () => {
  assert.match(rifiuto('translate-selection', 'Ctrl+T'), /^Ctrl\+T è già in uso \(apre una scheda nuova\)/);
  assert.match(rifiuto('translate-selection', 'Alt+E'), /già la scorciatoia di «Spiega»/);
  assert.match(rifiuto('translate-selection', 'Alt+F4'), /sistema operativo/);
  assert.match(rifiuto('translate-selection', 'Ctrl+C'), /copia/);
  assert.match(rifiuto('translate-selection', 'Ctrl+S'), /Editor/);
  assert.match(rifiuto('translate-selection', 'Ctrl+0'), /100%/);
  assert.match(rifiuto('translate-selection', 'Ctrl+Shift+Spazio'), /microfono/);
  assert.match(rifiuto('translate-selection', 'Alt+3'), /scheda/);
  assert.match(rifiuto('translate-selection', 'Ctrl+Alt+E'), /AltGr/);
  assert.equal(rifiuto('translate-selection', 'Ctrl+Alt+E', 'linux'), '');
  assert.match(rifiuto('translate-selection', 'Y'), /Ctrl o Alt/);
  assert.match(rifiuto('translate-selection', 'Shift+Y'), /Ctrl o Alt/);
  assert.match(rifiuto('translate-selection', 'Ctrl+Pippo+Y'), /Non riconosco «Pippo»/);
  assert.match(rifiuto('translate-selection', 'Ctrl+'), /Manca il tasto/);
  assert.match(rifiuto('translate-selection', 'Ctrl+Shift+-'), /Shift/);
  assert.match(rifiuto('translate-selection', 'Cmd+Q', 'darwin'), /chiude Filo/);
  // La sua stessa combinazione non è un conflitto, e una libera passa.
  assert.equal(rifiuto('translate-selection', 'Alt+T'), '');
  assert.equal(rifiuto('translate-selection', 'Ctrl+Shift+Y'), '');
  assert.equal(rifiuto('translate-selection', 'Ctrl+Maiusc+F5'), '');
});

test('i tasti che l\'Editor e il microfono usano non si danno a un\'azione di Filo, che li toglierebbe ovunque', () => {
  const editor = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  const elenco = editor.slice(editor.indexOf('const TASTI_EDITOR = ['), editor.indexOf('];', editor.indexOf('const TASTI_EDITOR = [')));
  const voci = [...elenco.matchAll(/tasti: \['((?:\\\\|[^'])+)'\](, shift: true)?/g)].map((m) => `Ctrl+${m[2] ? 'Shift+' : ''}${m[1].replace('\\\\', '\\')}`);
  assert.ok(voci.length >= 12, `la sentinella non trova più i tasti dell'Editor (${voci.length})`);
  for (const accel of [...voci, globalThis.SN_VOCE_CHAT.TASTO, 'Ctrl+=', 'Ctrl+-']) {
    for (const s of ['win32', 'linux', 'darwin']) {
      const r = T.rifiutoScorciatoiaFilo('explain-selection', accel, s);
      assert.ok(r, `${accel} su ${s} si darebbe a Spiega`);
    }
  }
});

test('la combinazione premuta diventa la forma salvata, coi tasti veri di ogni sistema', () => {
  const ev = (o) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true }), 'win32'), { accel: 'Ctrl+Shift+Y' });
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: 'Control', ctrlKey: true }), 'win32'), { attesa: true });
  // Il simbolo si salva col carattere che esce: Shift è già dentro.
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }), 'win32'), { accel: 'Ctrl+?' });
  // Le cifre dal tasto fisico: Shift+1 resta 1.
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }), 'win32'), { accel: 'Ctrl+Shift+1' });
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: ' ', code: 'Space', ctrlKey: true, altKey: true }), 'linux'), { accel: 'Ctrl+Alt+Spazio' });
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: 'F5', code: 'F5', altKey: true }), 'win32'), { accel: 'Alt+F5' });
  // AltGr su Windows arriva come Ctrl+Alt: si legge, e il controllo lo rifiuta.
  const altgr = T.scorciatoiaDaEvento(ev({ key: '€', code: 'KeyE', ctrlKey: true, altKey: true }), 'win32');
  assert.equal(altgr.accel, 'Ctrl+Alt+E');
  assert.equal(T.rifiutoScorciatoiaFilo('translate-selection', altgr.accel, 'win32').tipo, 'altgr');
  assert.equal(T.scorciatoiaDaEvento(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'win32').rifiuto.tipo, 'win');
  // Mac: Cmd è Ctrl, Control+Opzione è la forma di serie, Opzione o Control da soli no.
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }), 'darwin'), { accel: 'Ctrl+Shift+K' });
  assert.deepEqual(T.scorciatoiaDaEvento(ev({ key: '˚', code: 'KeyK', ctrlKey: true, altKey: true }), 'darwin'), { accel: 'Alt+K' });
  assert.equal(T.scorciatoiaDaEvento(ev({ key: '˚', code: 'KeyK', altKey: true }), 'darwin').rifiuto.tipo, 'macOpzione');
  assert.equal(T.scorciatoiaDaEvento(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'darwin').rifiuto.tipo, 'macControl');
  for (const r of ['macOpzione', 'macControl', 'macDue', 'win']) assert.ok(T.testoRifiutoFilo({ tipo: r }, 'darwin').length > 20);
  // Quello che si registra scatta alla stessa pressione.
  for (const [s, e, attesa] of [
    ['win32', ev({ key: 'Y', code: 'KeyY', ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+Y'],
    ['darwin', ev({ key: '˚', code: 'KeyK', ctrlKey: true, altKey: true }), 'Alt+K'],
    ['darwin', ev({ key: 'k', code: 'KeyK', metaKey: true, shiftKey: true }), 'Ctrl+Shift+K'],
  ]) {
    const { accel } = T.scorciatoiaDaEvento(e, s);
    assert.equal(accel, attesa);
    assert.equal(T.combaciaFilo(e, accel, s), true, `${accel} su ${s}`);
  }
});

test('la combinazione detta a parole: nomi italiani, e su Mac «Ctrl» con Alt è il Control', () => {
  assert.deepEqual(T.scorciatoiaDaScritta('ctrl + maiusc + y', 'win32'), { accel: 'Ctrl+Shift+Y' });
  assert.deepEqual(T.scorciatoiaDaScritta('Ctrl+Maiusc+Spazio', 'linux'), { accel: 'Ctrl+Shift+Spazio' });
  assert.deepEqual(T.scorciatoiaDaScritta('Ctrl+Alt+K', 'darwin'), { accel: 'Alt+K' });
  assert.deepEqual(T.scorciatoiaDaScritta('Cmd+Alt+K', 'darwin'), { accel: 'Ctrl+Alt+K' });
  assert.deepEqual(T.scorciatoiaDaScritta('Ctrl+K', 'darwin'), { accel: 'Ctrl+K' });
  assert.deepEqual(T.scorciatoiaDaScritta('Ctrl+Alt+K', 'win32'), { accel: 'Ctrl+Alt+K' });
  assert.equal(T.scorciatoiaDaScritta('   ', 'win32'), null);
  // Il nome che Filo mostra, riletto, è la stessa combinazione.
  for (const accel of ['Alt+K', 'Ctrl+Shift+Y', 'Ctrl+Alt+Shift+K', 'Alt+Shift+Invio']) {
    for (const s of ['win32', 'darwin', 'linux']) {
      assert.deepEqual(T.scorciatoiaDaScritta(T.etichettaFilo(accel, s), s), { accel }, `${accel} su ${s}`);
    }
  }
});

test('su Mac «Ctrl» senza Alt vale Cmd anche quando il tasto ha una A nel nome (verifica #842)', () => {
  for (const [scritta, accel] of [['Ctrl+Shift+A', 'Ctrl+Shift+A'], ['Ctrl+Shift+Spazio', 'Ctrl+Shift+Spazio'],
    ['Control+PagGiù', 'Ctrl+PagGiù'], ['Ctrl+Alt+A', 'Alt+A'], ['Ctrl+Pausa', 'Ctrl+Pausa']]) {
    assert.deepEqual(T.scorciatoiaDaScritta(scritta, 'darwin'), { accel }, scritta);
  }
});

test('i moduli dell\'Editor hanno gli stessi rifiuti delle quattro: AltGr e il microfono delle chat (verifica #842)', () => {
  assert.equal(T.rifiutoScritta('Ctrl+Alt+E', 'win32').tipo, 'altgr');
  assert.equal(T.rifiutoScritta('Ctrl+Alt+Shift+1', 'win32').tipo, 'altgr');
  assert.equal(T.rifiutoScritta('Ctrl+Alt+E', 'linux'), null);
  assert.equal(T.rifiutoScritta('Ctrl+Alt+Invio', 'win32'), null, 'AltGr scrive solo con un tasto che è un carattere');
  for (const s of ['win32', 'linux', 'darwin']) {
    const r = T.rifiutoScritta(s === 'darwin' ? 'Cmd+Shift+Spazio' : 'Ctrl+Shift+Spazio', s);
    assert.equal(r && r.tipo, 'presa', s);
    assert.match(r.cosa, /microfono/);
  }
  const editor = readFileSync(join(ROOT, 'src', 'pages', 'editor', 'editor.js'), 'utf8');
  assert.match(editor, /r\.tipo === 'altgr'/, 'l\'Editor spiega il rifiuto AltGr con le sue parole');
});

test('una combinazione di un modulo dell\'Editor, in qualunque documento, non va a una delle quattro (verifica #842)', () => {
  const build = (v) => P.buildPreferencePartial('scorciatoia', v);
  const collezione = (sc) => ({ files: [
    { meta: { title: 'Lettera' }, modules: [{ type: 'bold', data: {} }] },
    { meta: { title: 'Ricette' }, modules: [{ type: 'word-count', data: { shortcut: sc } }] },
  ] });
  try {
    T.usaScorciatoieModuli(collezione('Ctrl+Shift+Y'));
    const r = T.rifiutoScorciatoiaFilo('translate-selection', 'Ctrl+Shift+Y', 'win32');
    assert.equal(r && r.tipo, 'presa');
    assert.match(T.testoRifiutoFilo(r, 'win32'), /modulo dell'Editor nel documento «Ricette»/);
    assert.match(build('Traduci: Ctrl+Shift+Y').rifiuto, /«Ricette»/);
    // Il tasto di serie preso da un modulo: «tutte di serie» rimette le altre e dice perché quella resta.
    conScelta({ 'translate-selection': 'Ctrl+Shift+Y' }, () => {
      T.usaScorciatoieModuli(collezione('Alt+T'));
      const tutte = build('tutte di serie');
      assert.deepEqual(tutte.partial.scorciatoie, { 'explain-selection': '', 'save-for-later': '', 'open-help-sidebar': '' });
      assert.match(tutte.label, /tranne «Traduci»: Alt\+T è già in uso/);
      assert.match(build('Traduci: di serie').rifiuto, /«Ricette»/);
    });
    T.usaScorciatoieModuli(null);
    assert.equal(T.rifiutoScorciatoiaFilo('translate-selection', 'Ctrl+Shift+Y', 'win32'), null, 'tolto il modulo, la combinazione si libera');
  } finally {
    T.usaScorciatoieModuli(null);
  }
});

test('chiederlo a Filo cambia la scorciatoia con gli stessi controlli', () => {
  const build = (v) => P.buildPreferencePartial('scorciatoia', v);
  conScelta({}, () => {
    const r = build('Traduci: Ctrl+Maiusc+Y');
    assert.deepEqual(r.partial, { scorciatoie: { 'translate-selection': 'Ctrl+Shift+Y' } });
    assert.match(r.label, /«Traduci»/);
    assert.equal(r.costo, 1);
    assert.deepEqual(build('la traduzione = Ctrl+Shift+Y').partial, { scorciatoie: { 'translate-selection': 'Ctrl+Shift+Y' } });
    assert.match(build('Traduci: Ctrl+T').rifiuto, /scheda nuova/);
    assert.match(build('Aiuto: Alt+E').rifiuto, /«Spiega»/);
    assert.ok(build('Pippo: Ctrl+Shift+Y').rifiuto);
    assert.deepEqual(build('Aiuto: di serie').partial, { scorciatoie: { 'open-help-sidebar': '' } });
    assert.deepEqual(build('tutte di serie').partial.scorciatoie,
      { 'explain-selection': '', 'translate-selection': '', 'save-for-later': '', 'open-help-sidebar': '' });
    // Scegliere il tasto di serie salva «di serie», non una copia del tasto.
    assert.deepEqual(build('Spiega: Alt+E').partial, { scorciatoie: { 'explain-selection': '' } });
    assert.equal(build('Traduci'), null);
  });
  const setter = P.setterDi('scorciatoie.translate-selection');
  assert.deepEqual(setter.scrive, T.AZIONI_FILO.map((a) => `scorciatoie.${a.id}`));
  assert.equal(globalThis.SN_CAMBI.voce('scorciatoie.translate-selection').nome, 'scorciatoia di «Traduci»');
});

test('il main ascolta i tasti delle quattro solo da SN_TASTI, e lo fa sapere a chi registra', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'shortcuts.js'), 'utf8');
  assert.match(src, /azioneFiloDaTasto\(/);
  assert.doesNotMatch(src, /'Alt\+[A-Z]':/, 'una tabella di tasti scritta a mano in shortcuts.js');
  // Mentre le Preferenze registrano, i tasti che il main prende prima della pagina devono arrivarle.
  for (const rel of [['src', 'main', 'tabs.js'], ['src', 'main', 'tabs', 'tabZoom.js'], ['src', 'main', 'shortcuts.js']]) {
    assert.match(readFileSync(join(ROOT, ...rel), 'utf8'), /staRegistrandoTasti\(wc\)/, rel.join('/'));
  }
});

test('su Mac la barra dei menu, che vede i tasti per prima, li rigira alle Preferenze che stanno registrando', () => {
  const { oRegistra } = require(join(ROOT, 'src', 'main', 'menu.js'));
  const { registraTasti } = require(join(ROOT, 'src', 'main', 'shortcuts.js'));
  const mandati = [];
  const wc = { sendInputEvent: (e) => mandati.push(e) };
  let fatto = 0;
  const voce = oRegistra('CommandOrControl+Shift+T', () => { fatto += 1; }, true, () => wc);
  voce();
  assert.equal(fatto, 1, 'senza registrazione la voce fa la sua cosa');
  registraTasti(wc, true);
  voce();
  assert.equal(fatto, 1, 'mentre si registra la voce non apre la scheda');
  assert.deepEqual(mandati.map((e) => [e.type, e.keyCode, e.modifiers.join('+')]),
    [['keyDown', 'T', 'meta+shift'], ['keyUp', 'T', 'meta+shift']]);
  registraTasti(wc, false);
  voce();
  assert.equal(fatto, 2);
});
