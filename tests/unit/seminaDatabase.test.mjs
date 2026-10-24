// #759 — la codifica dei database del sito che «Resta connesso» porta fra jar: andata e ritorno senza perdite, e un
// valore che non si può trascrivere fa restare indietro il database invece di copiarlo a metà.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DB_CODIFICA, decodifica } = require('../../src/preload/semina-database.js');
const codifica = new Function(`${DB_CODIFICA}; return codifica;`)();
const andataRitorno = (v) => decodifica(JSON.parse(JSON.stringify(codifica(v))));

test('i valori di un database tornano uguali, tipi compresi', () => {
  const v = {
    uid: 'u1', n: 3.5, nan: NaN, inf: -Infinity, nulla: null, no: undefined, big: 12345678901234567890n,
    quando: new Date(1700000000000), re: /ab+c/gi, lista: [1, 'due', { tre: 3 }],
    byte: new Uint8Array([1, 2, 255]).buffer, vista: new Float32Array([1.5, -2]), dv: new DataView(new Uint8Array([9, 8]).buffer),
    mappa: new Map([['k', new Set([1, 2])]]), nudo: Object.assign(Object.create(null), { a: 1 }),
  };
  const r = andataRitorno(v);
  assert.equal(r.uid, 'u1');
  assert.ok(Number.isNaN(r.nan));
  assert.equal(r.inf, -Infinity);
  assert.equal(r.nulla, null);
  assert.ok('no' in r && r.no === undefined);
  assert.equal(r.big, 12345678901234567890n);
  assert.ok(r.quando instanceof Date && r.quando.getTime() === 1700000000000);
  assert.ok(r.re instanceof RegExp && r.re.source === 'ab+c' && r.re.flags === 'gi');
  assert.deepEqual(r.lista, [1, 'due', { tre: 3 }]);
  assert.deepEqual([...new Uint8Array(r.byte)], [1, 2, 255]);
  assert.ok(r.vista instanceof Float32Array);
  assert.deepEqual([...r.vista], [1.5, -2]);
  assert.ok(r.dv instanceof DataView && r.dv.getUint8(1) === 8);
  assert.ok(r.mappa instanceof Map && r.mappa.get('k') instanceof Set && r.mappa.get('k').has(2));
  assert.equal(r.nudo.a, 1);
  // Le chiavi composte di IndexedDB sono array di chiavi.
  assert.deepEqual(andataRitorno(['a', 1]), ['a', 1]);
});

test('un oggetto che non si trascrive (chiave crittografica, file) ferma la codifica', () => {
  class CryptoKey {}
  assert.throws(() => codifica({ chiave: new CryptoKey() }), /non copiabile/);
  assert.throws(() => codifica([new (class Blob {})()]), /non copiabile/);
});
