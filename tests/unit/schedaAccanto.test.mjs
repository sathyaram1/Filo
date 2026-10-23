// #590.14 — Ctrl+Tab e Ctrl+Shift+Tab (e Ctrl+PagGiù/PagSu) portano alla scheda accanto, come in ogni browser.
// Qui la regola (quale tasto, su quale sistema, come si chiama, che nessuno se lo assegni) e le porte attaccate;
// che la scheda cambi davvero lo prova tests/scheda-accanto-da-tastiera.spec.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'tasti.js'));
const T = globalThis.SN_TASTI;

const leggi = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('Ctrl+Tab è la successiva, Ctrl+Shift+Tab la precedente: dal DOM e dal main', () => {
  assert.equal(T.versoSchedaAccanto({ ctrlKey: true, key: 'Tab', code: 'Tab' }), 1);
  assert.equal(T.versoSchedaAccanto({ ctrlKey: true, shiftKey: true, key: 'Tab', code: 'Tab' }), -1);
  assert.equal(T.versoSchedaAccanto({ control: true, key: 'Tab', code: 'Tab' }), 1);
  assert.equal(T.versoSchedaAccanto({ control: true, shift: true, key: 'Tab', code: 'Tab' }), -1);
  // L'evento sintetico dei test porta solo `key`.
  assert.equal(T.versoSchedaAccanto({ control: true, key: 'Tab' }), 1);
});

test('Ctrl+PagGiù e Ctrl+PagSu valgono come in ogni browser; con Shift no', () => {
  assert.equal(T.versoSchedaAccanto({ ctrlKey: true, key: 'PageDown', code: 'PageDown' }), 1);
  assert.equal(T.versoSchedaAccanto({ control: true, key: 'PageUp', code: 'PageUp' }), -1);
  assert.equal(T.versoSchedaAccanto({ control: true, shift: true, key: 'PageDown', code: 'PageDown' }), 0);
});

test('non scatta per Tab da solo, Shift+Tab, Alt o AltGr, né col tasto Cmd/Windows', () => {
  for (const ev of [
    { key: 'Tab', code: 'Tab' },
    { shiftKey: true, key: 'Tab', code: 'Tab' },
    { altKey: true, key: 'Tab', code: 'Tab' },
    { ctrlKey: true, altKey: true, key: 'Tab', code: 'Tab' },
    { metaKey: true, key: 'Tab', code: 'Tab' },
    { ctrlKey: true, metaKey: true, key: 'Tab', code: 'Tab' },
    { ctrlKey: true, key: 'PageDown', code: 'PageDown', metaKey: true },
    { ctrlKey: true, key: 't', code: 'KeyT' },
    { key: 'PageDown', code: 'PageDown' },
    null,
  ]) assert.equal(T.versoSchedaAccanto(ev), 0, JSON.stringify(ev));
});

test('il nome è Ctrl+Tab su ogni sistema: su Mac è il tasto Control, Cmd+Tab è del sistema', () => {
  for (const s of ['win32', 'linux', 'darwin']) {
    assert.equal(T.etichettaSchedaSuccessiva(s), 'Ctrl+Tab', s);
    assert.equal(T.etichettaSchedaPrecedente(s), 'Ctrl+Shift+Tab', s);
  }
  assert.equal(T.etichetteSchedaAccanto(1), 'Ctrl+Tab, Ctrl+PagGiù');
  assert.equal(T.etichetteSchedaAccanto(-1), 'Ctrl+Shift+Tab, Ctrl+PagSu');
  // Nell'elenco dei tasti presi non diventa «Cmd+Tab» su Mac.
  assert.ok(T.tastiRiservati('darwin').includes('Ctrl+Tab'));
  assert.ok(!T.tastiRiservati('darwin').includes('Cmd+Tab'));
});

test('nessuno può assegnarsi i tasti della scheda accanto: Filo li prende prima della pagina', () => {
  for (const s of ['win32', 'linux']) {
    for (const a of ['Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+PagGiù', 'Ctrl+PageUp']) {
      assert.equal(T.riservato(a, s), true, `${a} su ${s}`);
    }
    assert.deepEqual(T.rifiutoScritta('Ctrl+Tab', s), { tipo: 'presa', nome: 'Ctrl+Tab', cosa: 'passa alla scheda successiva' });
    assert.equal(T.rifiutoScritta('Ctrl+Shift+Tab', s).cosa, 'passa alla scheda precedente');
    assert.equal(T.rifiutoScritta('Ctrl+PagSu', s).cosa, 'passa alla scheda precedente');
    // Le combinazioni vicine restano libere.
    assert.equal(T.riservato('Ctrl+Shift+PagGiù', s), false, s);
    assert.equal(T.riservato('Ctrl+Alt+Tab', s), false, s);
  }
  // Su Mac Ctrl+Tab scritto è Cmd+Tab, del sistema: rifiutato lo stesso.
  assert.equal(T.rifiutoScritta('Ctrl+Tab', 'darwin').tipo, 'sistema');
  // Il tasto fisico di un modulo dell'Editor passa dalla stessa lista.
  assert.equal(T.rifiutoFisico('c|Tab', null, 'win32').cosa, 'passa alla scheda successiva');
  assert.equal(T.rifiutoFisico('cs|Tab', null, 'linux').cosa, 'passa alla scheda precedente');
});

test('ogni porta è attaccata alla stessa regola: pagine, barra delle schede, barra dei menu', () => {
  assert.match(leggi('src', 'main', 'tabs.js'), /versoSchedaAccanto\(input\)[\s\S]{0,120}this\.attivaAccanto\(verso\)/,
    'il tasto premuto dentro una pagina non porta alla scheda accanto');
  assert.match(leggi('src', 'renderer', 'shell.js'), /versoSchedaAccanto\(e\)[\s\S]{0,120}api\.tabs\.accanto\(verso\)/,
    'col fuoco sulla barra delle schede il tasto non fa niente');
  const { template } = require(join(ROOT, 'src', 'main', 'menu.js'));
  for (const s of ['win32', 'darwin', 'linux']) {
    const voci = template(s).flatMap((m) => m.submenu || []);
    const succ = voci.find((v) => v.label === 'Scheda successiva');
    const prec = voci.find((v) => v.label === 'Scheda precedente');
    assert.equal(succ && succ.accelerator, 'Ctrl+Tab', s);
    assert.equal(prec && prec.accelerator, 'Ctrl+Shift+Tab', s);
    assert.equal(typeof succ.click, 'function');
    assert.ok(!succ.role && !prec.role);
  }
});

test('l\'elenco delle scorciatoie e il manifesto lo dicono', () => {
  assert.match(leggi('src', 'pages', 'options', 'altro.js'), /etichetteSchedaAccanto\(1\)[\s\S]*etichetteSchedaAccanto\(-1\)/);
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const cap = globalThis.SN_CAPABILITIES.CAPABILITIES.find((c) => c.id === 'switch-tab-next-previous');
  assert.ok(cap, 'il manifesto non sa che Ctrl+Tab cambia scheda');
  assert.match(cap.invoke, /Ctrl\+Tab/);
  assert.match(cap.invoke, /Mac[^.]*Control/);
});
