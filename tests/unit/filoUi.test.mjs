// Unit test per src/shared/filoUi.js (SN_FILO_UI) — #514.
//
// Due domande diverse sullo stesso marchio, e la differenza è chi risponde.
// `is`/`inside` leggono l'attributo nel documento: lì un sito che se lo mette
// addosso al massimo si esclude dalla traduzione. `aperti()` risponde a «questo
// pezzo l'ho disegnato io?», e a quella domanda l'attributo non può rispondere:
// il documento è del sito. Un sito che si marcava un elemento invisibile e se
// lo toglieva a ogni Esc teneva l'utente dentro allo schermo intero a tempo
// indeterminato. Da qui in poi conta solo chi è passato da `mark()`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/filoUi.js');
const UI = globalThis.SN_FILO_UI;

// Un elemento finto: quel tanto che serve al marchio e all'elenco.
function elemento(attaccato = true) {
  return {
    attrs: {},
    isConnected: attaccato,
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
  };
}

test('SN_FILO_UI espone mark/is/inside/aperti', () => {
  assert.ok(UI);
  for (const fn of ['mark', 'is', 'inside', 'aperti']) {
    assert.equal(typeof UI[fn], 'function', `manca ${fn}`);
  }
});

test('mark scrive l\'attributo e restituisce l\'elemento, così si incatena', () => {
  const el = elemento();
  assert.equal(UI.mark(el), el);
  assert.equal(el.getAttribute(UI.ATTR), '1');
  assert.equal(UI.is(el), true);
});

test('aperti() elenca quelle marcate e ancora attaccate, non le altre', () => {
  const viva = UI.mark(elemento(true));
  const chiusa = UI.mark(elemento(true));
  assert.ok(UI.aperti().includes(viva));
  assert.ok(UI.aperti().includes(chiusa));

  chiusa.isConnected = false;
  const dopo = UI.aperti();
  assert.ok(dopo.includes(viva), 'la radice ancora attaccata deve restare nell\'elenco');
  assert.ok(!dopo.includes(chiusa), 'la radice staccata è uscita di scena');
});

test('un elemento che si è messo l\'attributo da solo NON entra nell\'elenco', () => {
  // È il sito ostile: si traveste da riquadro di Filo scrivendosi l'attributo
  // addosso, senza passare da mark(). Per `is` è marcato (e va bene, si esclude
  // solo dalla traduzione), per `aperti()` non esiste.
  const finto = elemento(true);
  finto.setAttribute(UI.ATTR, '1');
  assert.equal(UI.is(finto), true, 'l\'attributo c\'è, e chi cammina lo salta');
  assert.ok(!UI.aperti().includes(finto), 'ma non l\'abbiamo disegnato noi: fuori dall\'elenco');
});

test('l\'elenco non cresce senza fine: oltre il tetto cadono le più vecchie', () => {
  const prima = UI.mark(elemento(true));
  const tante = [];
  for (let i = 0; i < 300; i++) tante.push(UI.mark(elemento(true)));
  const elenco = UI.aperti();
  assert.ok(elenco.length <= 256, `elenco cresciuto a ${elenco.length}`);
  assert.ok(!elenco.includes(prima), 'la più vecchia doveva uscire per prima');
  assert.ok(elenco.includes(tante[tante.length - 1]), 'l\'ultima marcata deve esserci');
});

test('mark() non pota: una radice marcata prima di essere attaccata sopravvive', () => {
  // Quasi tutti creano l'elemento, lo marcano e SOLO DOPO lo attaccano. Se
  // mark() buttasse via le staccate, butterebbe via proprio il riquadro che sta
  // per nascere.
  const nascente = UI.mark(elemento(false));
  UI.mark(elemento(true));
  nascente.isConnected = true;
  assert.ok(UI.aperti().includes(nascente));
});

// ── onMark: chi deve prepararsi PRIMA che l'utente prema un tasto ────────────
// Sopra lo schermo pieno di un sito l'Esc il browser se lo mangia per uscire, e
// nessun riquadro di Filo lo vede mai (#514, giro 10). Il tasto va CHIESTO nel
// momento in cui il riquadro nasce, quindi serve saperlo: `mark()` è l'unico
// punto da cui passano tutti, e da lì l'avviso arriva senza che chi scrive il
// riquadro numero otto debba ricordarsi di niente.
test('onMark avvisa chi si è iscritto, con l\'elemento appena marcato', () => {
  const visti = [];
  const stop = UI.onMark((el) => visti.push(el));
  const uno = UI.mark(elemento());
  const due = UI.mark(elemento());
  assert.deepEqual(visti, [uno, due]);
  stop();
  UI.mark(elemento());
  assert.equal(visti.length, 2, 'disiscritto: non arriva più niente');
});

test('un osservatore che esplode non ferma mark()', () => {
  const stop = UI.onMark(() => { throw new Error('rotto'); });
  const el = elemento();
  assert.equal(UI.mark(el), el, 'il marchio va messo comunque');
  assert.equal(UI.is(el), true);
  stop();
});

test('onMark ignora chi non passa una funzione e restituisce sempre un disiscrivi', () => {
  assert.equal(typeof UI.onMark(null), 'function');
  assert.equal(typeof UI.onMark('ciao'), 'function');
  UI.onMark(undefined)();
});
