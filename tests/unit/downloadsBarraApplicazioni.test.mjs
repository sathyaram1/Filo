// L'avanzamento dei download sull'icona di Filo nella barra delle applicazioni (#941): senza un tasto nella
// fila di tab è l'unico segno, fuori dalla home, che un file sta arrivando. Logica pura, senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { _avanzamentoBarra: barra } = require(join(ROOT, 'src', 'main', 'services', 'downloads.js'));

const voce = (state, receivedBytes, totalBytes) => ({ state, receivedBytes, totalBytes });

test('nessun download in corso: la barra sull’icona non c’è', () => {
  assert.deepEqual(barra([]), { value: -1, mode: 'none' });
  assert.deepEqual(barra([voce('completed', 10, 10), voce('cancelled', 2, 10), voce('interrupted', 3, 10)]),
    { value: -1, mode: 'none' });
});

test('un programma che aspetta la risposta non riempie la barra: non sta scaricando', () => {
  assert.deepEqual(barra([voce('pending', 500, 1000)]), { value: -1, mode: 'none' });
});

test('più download in corso: la barra è la somma dei byte, non la media delle percentuali', () => {
  const r = barra([voce('progressing', 900, 1000), voce('progressing', 0, 9000), voce('completed', 50, 50)]);
  assert.equal(r.mode, 'normal');
  assert.equal(r.value, 0.09);
});

test('senza dimensione nota la barra è indeterminata, e con una sola dimensione nota conta quella', () => {
  assert.deepEqual(barra([voce('progressing', 300, 0)]), { value: 2, mode: 'indeterminate' });
  assert.deepEqual(barra([voce('progressing', 300, 0), voce('progressing', 25, 100)]), { value: 0.25, mode: 'normal' });
});

test('tutto in pausa: barra ferma al punto raggiunto', () => {
  assert.deepEqual(barra([voce('paused', 40, 100)]), { value: 0.4, mode: 'paused' });
  assert.deepEqual(barra([voce('paused', 40, 0)]), { value: 0, mode: 'paused' });
});

test('byte ricevuti oltre il totale dichiarato non mandano la barra oltre il pieno', () => {
  assert.deepEqual(barra([voce('progressing', 1500, 1000)]), { value: 1, mode: 'normal' });
});
