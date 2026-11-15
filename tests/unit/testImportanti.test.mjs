// Le prove importanti (#2501): il tetto di durata fa rossa una corsa verde troppo lunga, e l'elenco gira su un avvio solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leggiArgomenti, verdettoImportanti, TETTO_S, SPEC } from '../../scripts/test-importanti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('il tetto è di quattro minuti, e sopra la corsa è rossa anche con le prove verdi', () => {
  assert.equal(TETTO_S, 240);
  assert.equal(verdettoImportanti({ codice: 0, durataMs: 239_000 }).codice, 0);
  const lunga = verdettoImportanti({ codice: 0, durataMs: 241_000 });
  assert.equal(lunga.codice, 1);
  assert.match(lunga.testo, /DURATA SOPRA IL TETTO: 241 s contro 240 s/);
  assert.equal(verdettoImportanti({ codice: 1, durataMs: 1000 }).codice, 1);
});

test('--tetto si sceglie per provare il controllo; il resto va a Playwright', () => {
  assert.deepEqual(leggiArgomenti(['--tetto', '5', '--reporter=list']), { tettoS: 5, resto: ['--reporter=list'] });
  assert.ok(leggiArgomenti(['--tetto', 'x']).errore);
  assert.equal(verdettoImportanti({ codice: 0, durataMs: 6000, tettoS: 5 }).codice, 1);
});

test('npm run test:importanti lancia lo script, e lo spec avvia Filo una volta più il riavvio', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:importanti'], 'node scripts/test-importanti.mjs');
  const spec = readFileSync(resolve(ROOT, SPEC), 'utf8');
  assert.equal((spec.match(/electron\.launch\(/g) || []).length, 1, 'un solo punto che avvia Filo');
  assert.equal((spec.match(/await avvia\(\)/g) || []).length, 2, 'l\'avvio e il riavvio del cammino dell\'impostazione');
  assert.match(spec, /test\.describe\.configure\(\{ mode: 'serial' \}\)/);
});
