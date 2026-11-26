// #2677 — le regole del pavimento che cercano l'etichetta dentro un nome di campo si compongono dai pezzi dell'elenco,
// mai ritagliando il testo di un'altra: il ritaglio di ETICHETTA, fuso con un cambio della sua forma, rompeva il caricamento.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sorgente = readFileSync(new URL('../../src/shared/pavimento.js', import.meta.url), 'utf8');

test('nessuna etichetta del pavimento nasce ritagliando il testo di un\'altra', () => {
  const ritagli = sorgente.split('\n').filter((r) => /\bETICHETTA\w*\.(?:slice|substring|substr|replace)\(/.test(r));
  assert.deepEqual(ritagli, []);
});
