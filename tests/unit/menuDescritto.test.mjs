// #1054 — il menu come dati fra il content script e lo strato sopra la scheda: le funzioni restano dove sono nate e
// viaggiano come numero, gli elementi come segno, e niente che non sia dato arriva dall'altra parte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/menuDescritto.js');
const D = globalThis.SN_MENU_DESCRITTO;

test('le funzioni diventano numeri e tornano funzioni che chiamano quel numero', () => {
  const tenute = [];
  const op = { speciale: (v) => (typeof v === 'function' ? { $fn: tenute.push(v) - 1 } : undefined) };
  const voci = [
    { type: 'item', label: 'Copia', onClick: () => 'copia' },
    { type: 'split', label: 'Detta', onClick: () => 'detta', subItems: [{ label: 'Modello', onClick: () => 'modello' }] },
    { type: 'row', items: [{ id: 'back', icon: '<svg></svg>', disabled: true, onClick: () => 'indietro' }], onDrop: () => 'posa' },
  ];
  const dati = D.descrivi(voci, op);
  assert.equal(JSON.stringify(dati), JSON.stringify(JSON.parse(JSON.stringify(dati))));
  assert.deepEqual(dati[0], { type: 'item', label: 'Copia', onClick: { $fn: 0 } });
  assert.deepEqual(dati[1].subItems[0].onClick, { $fn: 2 });
  assert.deepEqual(dati[2].onDrop, { $fn: 4 });

  const chiamati = [];
  const indietro = D.ricostruisci(dati, { funzione: (n) => () => chiamati.push(n) });
  indietro[2].items[0].onClick();
  indietro[1].subItems[0].onClick();
  assert.deepEqual(chiamati, [3, 2]);
  assert.equal(tenute[3](), 'indietro');
  assert.equal(indietro[2].items[0].disabled, true);
});

test('un elemento, un oggetto con prototipo suo, un numero non finito e un ciclo non passano', () => {
  class Nodo { constructor() { this.nodeType = 1; } }
  const ciclo = { label: 'a' };
  ciclo.dentro = ciclo;
  const dati = D.descrivi({ el: new Nodo(), data: new Date(0), n: Infinity, ciclo, simbolo: Symbol('x') }, {});
  assert.equal(dati.el, null);
  assert.equal(dati.data, null);
  assert.equal(dati.n, null);
  assert.equal(dati.simbolo, null);
  let livelli = 0;
  for (let c = dati.ciclo; c && typeof c === 'object'; c = c.dentro) livelli++;
  assert.ok(livelli <= D.PROFONDITA_MAX + 1, `il ciclo si ferma (${livelli} livelli)`);
});

test('un segno di ancora torna oggetto solo a chi sa cosa farne', () => {
  const dati = { args: [{ $ancora: 'a1' }, { id: 'qrCode', target: 'primary', beforeId: null }] };
  assert.deepEqual(D.ricostruisci(dati, {}).args[0], null);
  const via = D.ricostruisci(dati, { ancora: (s) => ({ segno: s }) });
  assert.deepEqual(via.args, [{ segno: 'a1' }, { id: 'qrCode', target: 'primary', beforeId: null }]);
});

test('il cammino di un bottone dentro una sezione lo ritrova dall\'altra parte', () => {
  const el = (figli = []) => {
    const n = { children: figli, parentElement: null };
    for (const f of figli) f.parentElement = n;
    return n;
  };
  const freccia = el();
  const corpo = el([el(), freccia]);
  const radice = el([el(), corpo]);
  assert.deepEqual(D.cammino(radice, freccia), [1, 1]);
  assert.equal(D.trova(radice, [1, 1]), freccia);
  assert.equal(D.trova(radice, [5]), null);
  assert.equal(D.trova(radice, ['1']), null);
  assert.equal(D.cammino(radice, el()), null);
});
