// Il vuoto di una vista sopra la pagina segue il puntatore della pagina: quando la vista se ne va (lo strato dei riquadri
// buttato dopo una navigazione o un minuto vuoto) un cambio di puntatore non deve far nascere un errore nel processo
// principale, che blocca Filo con la sua finestra (#1509.1), e chi la butta stacca l'ascoltatore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { VuotoDellaVista } = require('../../src/main/vuotoDellaVista.js');

function pagina() {
  const wc = new EventEmitter();
  wc.isDestroyed = () => false;
  wc.ricevuti = [];
  wc.sendInputEvent = (ev) => wc.ricevuti.push(ev);
  return { webContents: wc, getBounds: () => ({ x: 0, y: 40 }) };
}

function vista() {
  const wc = { isDestroyed: () => false, mandati: [], send(c, d) { this.mandati.push([c, d]); } };
  return { webContents: wc, getBounds: () => ({ x: 0, y: 40 }) };
}

test('la vista buttata: un cambio di puntatore della pagina non lancia', () => {
  const p = pagina();
  let v = vista();
  const vuoto = new VuotoDellaVista({ vista: () => v, scheda: () => p, canale: 'prova:cursore' });
  vuoto.inoltra({ tipo: 'mouseMove', x: 10, y: 10 });
  assert.equal(p.webContents.ricevuti.length, 1);
  p.webContents.emit('cursor-changed', {}, 'hand');
  assert.deepEqual(v.webContents.mandati.at(-1), ['prova:cursore', 'hand']);
  // Chiusa, la vista non ha più il suo webContents.
  v = { webContents: undefined, getBounds: () => ({ x: 0, y: 40 }) };
  assert.doesNotThrow(() => p.webContents.emit('cursor-changed', {}, 'pointer'));
  v = null;
  assert.doesNotThrow(() => p.webContents.emit('cursor-changed', {}, 'hand'));
});

test('chi butta la vista stacca il vuoto dalla pagina', () => {
  const p = pagina();
  const v = vista();
  const vuoto = new VuotoDellaVista({ vista: () => v, scheda: () => p, canale: 'prova:cursore' });
  vuoto.inoltra({ tipo: 'mouseMove', x: 10, y: 10 });
  assert.equal(p.webContents.listenerCount('cursor-changed'), 1);
  vuoto.stacca();
  assert.equal(p.webContents.listenerCount('cursor-changed'), 0);
  p.webContents.emit('cursor-changed', {}, 'hand');
  assert.equal(v.webContents.mandati.length, 0);
});
