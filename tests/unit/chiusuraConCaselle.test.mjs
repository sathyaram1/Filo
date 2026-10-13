// #666 — chiudere una scheda non dà alla pagina nessun evento: con caselle ancora da spedire la pagina viene avvisata e
// la sua WebContents si chiude quando ha spedito, o al tetto; senza, si chiude subito come prima.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../src/main/tabs/chiusuraConCaselle.js');

function finta() {
  return {
    chiusa: 0, inviati: [], muta: false, morta: false,
    isDestroyed() { return this.morta; },
    close() { this.chiusa += 1; this.morta = true; },
    send(canale, m) { this.inviati.push([canale, m]); },
    setAudioMuted(v) { this.muta = v; },
  };
}

test('senza caselle in sospeso la pagina si chiude subito, senza messaggi', () => {
  const wc = finta();
  C.chiudi(wc);
  assert.equal(wc.chiusa, 1);
  assert.deepEqual(wc.inviati, []);
});

test('con caselle in sospeso la pagina sa che esce, e si chiude quando dice di aver spedito', () => {
  const wc = finta();
  C.segna(wc, true);
  C.chiudi(wc);
  assert.equal(wc.chiusa, 0);
  assert.deepEqual(wc.inviati, [['filo:broadcast', { type: 'tab_in_vista', inVista: false }]]);
  assert.equal(wc.muta, true);
  // Una seconda chiusura mentre aspetta non manda un secondo avviso.
  C.chiudi(wc);
  assert.equal(wc.inviati.length, 1);
  C.segna(wc, false);
  assert.equal(wc.chiusa, 1);
  C.segna(wc, false);
  assert.equal(wc.chiusa, 1);
});

test('una pagina che non risponde si chiude al tetto', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wc = finta();
  C.segna(wc, true);
  C.chiudi(wc);
  t.mock.timers.tick(C.TETTO_MS - 1);
  assert.equal(wc.chiusa, 0);
  t.mock.timers.tick(1);
  assert.equal(wc.chiusa, 1);
});

test('una WebContents già distrutta o senza isDestroyed non fa danni', () => {
  const morta = finta();
  morta.morta = true;
  C.chiudi(morta);
  assert.equal(morta.chiusa, 0);
  let chiusa = 0;
  C.chiudi({ close() { chiusa += 1; } });
  assert.equal(chiusa, 1);
  C.chiudi(null);
});
