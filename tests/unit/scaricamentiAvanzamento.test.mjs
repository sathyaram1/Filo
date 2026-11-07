// Unit test per src/shared/scaricamentiAvanzamento.js — velocità e tempo che resta di uno scaricamento (#1287).
// Logica pura: il main la usa per misurare, pannello, pagina Download e carte della home per scrivere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'scaricamentiAvanzamento.js'));
const A = globalThis.SN_SCARICAMENTI_AVANZAMENTO;
const MB = 1024 * 1024;

function campioni(punti) {
  let c = [];
  for (const [t, b] of punti) c = A.campiona(c, t, b);
  return c;
}

test('la velocità è quella degli ultimi secondi, e il tempo che resta ne segue', () => {
  const c = campioni([[0, 0], [1000, 1 * MB], [2000, 2 * MB]]);
  const v = A.velocita(c, 2000);
  assert.equal(Math.round(v), MB);
  assert.equal(A.restano(2 * MB, 10 * MB, v), 8);
  assert.equal(A.velocitaEResto({ state: 'progressing', velocita: v, restano: 8 }), '1.0 MB/s · ancora 8 s');
});

test('una rete che rallenta si legge subito: i campioni vecchi escono dalla finestra', () => {
  const c = campioni([[0, 0], [1000, 10 * MB], [2000, 20 * MB], [8000, 21 * MB], [9000, 22 * MB], [10000, 23 * MB]]);
  const v = A.velocita(c, 10000);
  assert.ok(v < 2 * MB, `ancora alla velocità di prima: ${v}`);
});

test('fermo da un po’ senza pacchetti, la velocità scende invece di restare quella dell’ultimo', () => {
  const c = campioni([[0, 0], [1000, 4 * MB]]);
  assert.ok(A.velocita(c, 20000) < A.velocita(c, 1000) / 5);
});

test('senza abbastanza misure, senza totale o con byte che tornano indietro non si inventa niente', () => {
  assert.equal(A.velocita(campioni([[0, 0]]), 5000), 0);
  assert.equal(A.velocita(campioni([[0, 0], [200, 5 * MB]]), 200), 0);
  assert.equal(A.restano(MB, 0, MB), null);
  assert.equal(A.restano(MB, 10 * MB, 0), null);
  // Un tentativo ripartito da capo non dà una velocità negativa.
  const c = campioni([[0, 0], [1000, 5 * MB], [2000, 100], [3000, MB + 100]]);
  assert.ok(A.velocita(c, 3000) >= 0);
  assert.equal(A.velocitaEResto({ state: 'progressing', velocita: 0, restano: null }), '');
  assert.equal(A.velocitaEResto({ state: 'paused', velocita: MB, restano: 3 }), '');
  assert.equal(A.velocitaEResto({ state: 'progressing', velocita: 300 * 1024, restano: null }), '300 KB/s');
});

test('il tempo che resta si legge senza conti: secondi, minuti, ore', () => {
  assert.equal(A.testoResto(0), 'ancora 1 s');
  assert.equal(A.testoResto(42), 'ancora 42 s');
  assert.equal(A.testoResto(61), 'ancora 2 min');
  assert.equal(A.testoResto(3600), 'ancora 1 h');
  assert.equal(A.testoResto(3600 + 25 * 60), 'ancora 1 h 25 min');
  assert.equal(A.testoResto(5 * 86400), 'ancora 5 giorni');
  assert.equal(A.testoResto(null), '');
});
