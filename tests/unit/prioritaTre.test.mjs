// Una priorità 3 la toglie solo l'owner (#2000, #2291): né abbassata né archiviata da un'automazione, anche quando chi
// scrive non sa la priorità di adesso. La regola è una sola (src/shared/prioritaTre.js) e il manutentore la chiede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'prioritaTre.js'));
const P = globalThis.SN_PRIORITA_TRE;

test('una 3 non scende senza l\'owner, nemmeno di un grado; l\'owner la abbassa', () => {
  for (const nuova of [0, 1, 2, '1']) {
    const c = P.scrittura(3, nuova);
    assert.equal(c.ok, false);
    assert.equal(c.errore, 'tre');
  }
  assert.equal(P.scrittura('3', 1).errore, 'tre');
  assert.deepEqual(P.scrittura(3, 1, { owner: true }), { ok: true, valore: 1 });
  assert.deepEqual(P.scrittura(3, 3), { ok: true, valore: 3 });
});

test('chi non sa la priorità di adesso non scrive sotto la 3: potrebbe essere una 3', () => {
  for (const ignota of [null, undefined, '', 'FENC1:abc', 7, 2.5]) {
    const c = P.scrittura(ignota, 1);
    assert.equal(c.ok, false, `attuale ${String(ignota)}`);
    assert.equal(c.errore, 'ignota');
  }
  assert.deepEqual(P.scrittura(null, 3), { ok: true, valore: 3 });
  assert.deepEqual(P.scrittura(null, 0, { owner: true }), { ok: true, valore: 0 });
});

test('sotto la 3 il manutentore sale e scende come vuole', () => {
  assert.deepEqual(P.scrittura(2, 1), { ok: true, valore: 1 });
  assert.deepEqual(P.scrittura(1, 0), { ok: true, valore: 0 });
  assert.deepEqual(P.scrittura(0, '2'), { ok: true, valore: 2 });
  assert.deepEqual(P.scrittura(1, 3), { ok: true, valore: 3 });
});

test('valori storti rifiutati prima di tutto, anche all\'owner', () => {
  for (const v of [4, -1, '', 'alta', 1.5, null]) assert.equal(P.scrittura(1, v, { owner: true }).errore, 'valore');
});

test('un feedback a priorità 3, o di priorità ignota, non si archivia senza l\'owner', () => {
  assert.equal(P.archiviazione(3).errore, 'tre');
  assert.equal(P.archiviazione(null).errore, 'ignota');
  assert.deepEqual(P.archiviazione(3, { owner: true }), { ok: true });
  assert.deepEqual(P.archiviazione(2), { ok: true });
  assert.deepEqual(P.archiviazione(0), { ok: true });
});

test('archiviare una 3 dentro un lavoro che continua a 3 la sposta, non la toglie', () => {
  assert.deepEqual(P.archiviazione(3, { continuaA: 3 }), { ok: true });
  assert.deepEqual(P.archiviazione(null, { continuaA: '3' }), { ok: true });
  assert.equal(P.archiviazione(3, { continuaA: 1 }).errore, 'tre');
  assert.equal(P.archiviazione(null, { continuaA: null }).errore, 'ignota');
});

test('il manutentore non tiene una copia sua della regola', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'manutentore.mjs'), 'utf8');
  assert.match(src, /import '\.\.\/src\/shared\/prioritaTre\.js'/);
  assert.match(src, /PRIORITA_TRE\.scrittura\(/);
  assert.match(src, /PRIORITA_TRE\.archiviazione\(/);
  assert.doesNotMatch(src, /Number\(attuale\) === 3/);
});
