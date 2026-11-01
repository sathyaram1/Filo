// #1606 — Riaprire Filo rimasto acceso senza la finestra principale (chiusa con la finestrella di accesso aperta) la
// rifà e la porta davanti, invece di toccare quella distrutta. Electron è finto: conta quale finestra si chiede.
// Regola: mostraFinestraNormale in src/main/window.js; la strada della seconda apertura sta in src/main/main.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Come Electron: una finestra distrutta lancia a ogni metodo che non sia isDestroyed.
function finestraFinta({ distrutta = false, schede = true, incognito = false, minimizzata = false } = {}) {
  const chiamate = [];
  const w = { chiamate, isDestroyed: () => distrutta, on() {}, once() {}, loadURL() {}, webContents: { on() {}, once() {} } };
  const metodo = (nome, effetto = () => {}) => (...a) => {
    if (distrutta) throw new TypeError('Object has been destroyed');
    chiamate.push(nome);
    return effetto(...a);
  };
  w.isMinimized = metodo('isMinimized', () => minimizzata);
  w.restore = metodo('restore', () => { minimizzata = false; });
  for (const n of ['show', 'showInactive', 'moveTop', 'focus', 'setOpacity', 'setPosition']) w[n] = metodo(n);
  if (schede) w._filoTabs = { finta: true };
  if (incognito) w._filoIncognito = true;
  return w;
}

let finestre = [];
const nate = [];
const allUscita = [];
function BrowserWindow() {
  const w = finestraFinta();
  nate.push(w);
  finestre.push(w);
  return w;
}
BrowserWindow.getAllWindows = () => finestre.slice();
const electron = {
  BrowserWindow,
  session: {},
  screen: { getPrimaryDisplay: () => ({ scaleFactor: 1 }) },
  app: { on: (ev, cb) => { if (ev === 'before-quit') allUscita.push(cb); } },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  const daFinestra = parent && /[\\/]src[\\/]main[\\/]window\.js$/.test(parent.filename || '');
  if (daFinestra && request === './tabs') return { TabManager: class { constructor(win) { this.win = win; } } };
  if (daFinestra && request === './shortcuts') return { collegaScorciatoie() {} };
  if (daFinestra && request === './protocol') return { registerFiloProtocolForSession() {} };
  return origLoad.call(this, request, parent, isMain);
};
const W = require(join(ROOT, 'src', 'main', 'window.js'));
Module._load = origLoad;

const avvisate = [];
W.onFinestraNormale((w) => avvisate.push(w));
const rivelata = (w) => w.chiamate.includes('focus') || w.chiamate.includes('showInactive');
const daCapo = (...lista) => { finestre = lista; nate.length = 0; avvisate.length = 0; };

test('principale distrutta e finestrella di accesso aperta: ne nasce una nuova, davanti, e il main la riceve', () => {
  const principale = finestraFinta({ distrutta: true });
  const accesso = finestraFinta({ schede: false });
  daCapo(principale, accesso);
  const win = W.mostraFinestraNormale();
  assert.equal(nate.length, 1, 'chi riapre Filo deve ritrovare la finestra con le sue schede');
  assert.equal(win, nate[0]);
  assert.ok(rivelata(win), 'la finestra rifatta resta dietro: chi ha riaperto Filo non la vede');
  assert.deepEqual(avvisate, [win], 'senza l\'avviso il main resta puntato alla finestra distrutta');
  assert.deepEqual(accesso.chiamate, [], 'la finestrella di accesso non va toccata');
});

test('principale viva e ridotta a icona: si rimette su la stessa, senza farne un\'altra', () => {
  const principale = finestraFinta({ minimizzata: true });
  daCapo(principale);
  assert.equal(W.mostraFinestraNormale(), principale);
  assert.equal(nate.length, 0);
  assert.ok(principale.chiamate.includes('restore'), 'ridotta a icona resta sulla barra delle applicazioni');
  assert.ok(rivelata(principale));
});

test('aperta solo una finestra incognito: chi riapre Filo trova una finestra normale', () => {
  const incognito = finestraFinta({ incognito: true });
  daCapo(incognito);
  const win = W.mostraFinestraNormale();
  assert.equal(nate.length, 1);
  assert.equal(win, nate[0]);
  assert.ok(!incognito.chiamate.includes('focus'), 'davanti va la finestra normale, non l\'incognito');
});

test('la seconda apertura e l\'invito da fuori chiedono la finestra, mai il riferimento del main', () => {
  const main = readFileSync(join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  const corpo = (re, cosa) => { const m = main.match(re); assert.ok(m, `non trovo ${cosa} in main.js`); return m[1]; };
  const seconda = corpo(/app\.on\(\s*'second-instance'[^{]*\{([\s\S]*?)\n {2}\}\);/, 'il gestore di second-instance');
  assert.match(seconda, /mostraFinestraNormale\(\)/, 'la seconda apertura deve passare da mostraFinestraNormale');
  assert.doesNotMatch(seconda, /mainWindow\.\w+\(/, 'un metodo sul riferimento del main lancia se la finestra è distrutta');
  const invito = corpo(/function apriInvito\(code\) \{([\s\S]*?)\n\}/, 'apriInvito');
  assert.match(invito, /mostraFinestraNormale\(\)/, 'l\'invito arrivato da fuori deve aprire Crediti in una finestra viva');
  assert.doesNotMatch(invito, /\(\s*mainWindow\s*\)|,\s*mainWindow\s*\)/, 'passare il riferimento del main porta Crediti in una finestra distrutta');
});

// Ultima: l'uscita in corso è uno stato del modulo che non torna indietro.
test('durante l\'uscita non nasce nessuna finestra, e niente lancia', () => {
  daCapo(finestraFinta({ distrutta: true }));
  for (const cb of allUscita) cb();
  assert.equal(W.mostraFinestraNormale(), null);
  assert.equal(nate.length, 0, 'una finestra nuova annullerebbe l\'uscita');
});
