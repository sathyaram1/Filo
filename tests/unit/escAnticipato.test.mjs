// #859: l'Esc va agli ascolti in cattura di Filo prima che agli script del sito (anticipa in src/preload/riscrittura.js).
// Qui le regole della propagazione che la copia deve rispettare; il giro vero sulla pagina sta in
// tests/esc-sito-che-si-tiene-il-tasto.spec.mjs.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const proto = EventTarget.prototype;
const originali = { add: proto.addEventListener, togli: proto.removeEventListener };
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
const riscrittura = require('../../src/preload/riscrittura.js')();
after(() => {
  proto.addEventListener = originali.add;
  proto.removeEventListener = originali.togli;
  delete globalThis.window;
  delete globalThis.document;
});

let n = 0;
const tipoNuovo = () => `tasto-${++n}`;

test('gli ascolti in cattura dopo il primo, finestra poi documento; prima e bolla restano al giro vero', () => {
  const tipo = tipoNuovo();
  const visti = [];
  window.addEventListener(tipo, () => visti.push('prima del primo'), true);
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  window.addEventListener(tipo, (e) => visti.push(['finestra', e.currentTarget === window, e.eventPhase]), { capture: true });
  document.addEventListener(tipo, (e) => visti.push(['documento', e.currentTarget === document, e.eventPhase]), true);
  document.addEventListener(tipo, () => visti.push('bolla'));
  const e = new Event(tipo, { cancelable: true });
  assert.equal(riscrittura.anticipa(e, primo), false);
  assert.deepEqual(visti, [['finestra', true, 1], ['documento', true, 1]]);

  visti.length = 0;
  document.dispatchEvent(e);
  assert.deepEqual(visti, ['bolla'], 'il giro vero non ripete chi l\'ha già visto');
});

test('chi ferma la propagazione ferma la copia e lo dice', () => {
  const tipo = tipoNuovo();
  const visti = [];
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  window.addEventListener(tipo, (e) => { visti.push('menu'); e.stopPropagation(); }, true);
  window.addEventListener(tipo, () => visti.push('stessa tappa'), true);
  document.addEventListener(tipo, () => visti.push('documento'), true);
  assert.equal(riscrittura.anticipa(new Event(tipo), primo), true);
  assert.deepEqual(visti, ['menu', 'stessa tappa']);
});

test('stopImmediatePropagation salta anche il resto della tappa', () => {
  const tipo = tipoNuovo();
  const visti = [];
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  document.addEventListener(tipo, (e) => { visti.push('riquadro'); e.stopImmediatePropagation(); }, true);
  document.addEventListener(tipo, () => visti.push('dopo'), true);
  assert.equal(riscrittura.anticipa(new Event(tipo), primo), true);
  assert.deepEqual(visti, ['riquadro']);
});

test('preventDefault arriva al tasto vero, tranne da un ascolto passivo', () => {
  const tipo = tipoNuovo();
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  window.addEventListener(tipo, (e) => e.preventDefault(), { capture: true, passive: true });
  const passivo = new Event(tipo, { cancelable: true });
  riscrittura.anticipa(passivo, primo);
  assert.equal(passivo.defaultPrevented, false);

  document.addEventListener(tipo, (e) => e.preventDefault(), true);
  const vero = new Event(tipo, { cancelable: true });
  assert.equal(riscrittura.anticipa(vero, primo), false, 'preventDefault non ferma la propagazione');
  assert.equal(vero.defaultPrevented, true);
});

test('un ascolto «una volta» scatta una volta sola; uno tolto da chi viene prima non scatta', () => {
  const tipo = tipoNuovo();
  const visti = [];
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  const tolto = () => visti.push('tolto');
  window.addEventListener(tipo, () => document.removeEventListener(tipo, tolto, true), true);
  document.addEventListener(tipo, () => visti.push('una volta'), { capture: true, once: true });
  document.addEventListener(tipo, tolto, true);
  riscrittura.anticipa(new Event(tipo), primo);
  riscrittura.anticipa(new Event(tipo), primo);
  assert.deepEqual(visti, ['una volta']);
});

test('un ascolto che si rompe non toglie il tasto a quelli dopo', () => {
  const tipo = tipoNuovo();
  const visti = [];
  const primo = () => {};
  window.addEventListener(tipo, primo, true);
  window.addEventListener(tipo, () => { throw new Error('rotto'); }, true);
  document.addEventListener(tipo, () => visti.push('dopo'), true);
  const errore = console.error;
  const reportError = globalThis.reportError;
  const segnalati = [];
  globalThis.reportError = (err) => segnalati.push(err.message);
  console.error = () => {};
  try { riscrittura.anticipa(new Event(tipo), primo); } finally {
    console.error = errore;
    if (reportError) globalThis.reportError = reportError; else delete globalThis.reportError;
  }
  assert.deepEqual(visti, ['dopo']);
  assert.deepEqual(segnalati, ['rotto']);
});
