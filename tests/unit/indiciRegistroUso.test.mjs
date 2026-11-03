// #2060: il server legge il registro d'uso dei crediti con due query che vogliono un indice composto (pseudonimo e ora,
// nei due versi). Senza, la scheda di una persona in Gestione rilegge tutte le sue righe e la riconciliazione di chi ha
// chiesto una chiave nuova si ferma; gli indici si pubblicano con le regole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('firestore.indexes.json ha gli indici del registro d\'uso: pseudonimo uguale, ora crescente e decrescente', () => {
  const { indexes } = JSON.parse(readFileSync(join(ROOT, 'firestore.indexes.json'), 'utf8'));
  const presente = (verso) => indexes.some((i) => i.collectionGroup === 'wallet-usage' && i.queryScope === 'COLLECTION'
    && JSON.stringify(i.fields) === JSON.stringify([{ fieldPath: 'pseudonym', order: 'ASCENDING' }, { fieldPath: 'at', order: verso }]));
  assert.ok(presente('ASCENDING'), 'righe dopo una nuova chiave, sommate e contate');
  assert.ok(presente('DESCENDING'), 'le ultime 200 righe della scheda');
});
