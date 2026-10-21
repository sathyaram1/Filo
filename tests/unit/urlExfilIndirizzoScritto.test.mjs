// La regola dell'indirizzo scritto (#553, decisione su D-20, opzione 3): uno scritto dal modello dopo testo di
// sconosciuti vale costo 3 e chiede un OK, comunque sia scritto: nessun elenco fisso lo ferma del tutto.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src', 'shared', 'autonomia.js'));
require(join(ROOT, 'src', 'shared', 'urlExfil.js'));
require(join(ROOT, 'src', 'shared', 'actionLevels.js'));
const L = globalThis.SN_ACTION_LEVELS;
const A = globalThis.SN_AUTONOMIA;

test('il costo: compare 1, scritto dal modello 3', () => {
  const url = 'https://att.example/r?d=x';
  assert.equal(L.costoFor({ type: 'LEGGI_PAGINA', url }), 1);
  assert.equal(L.costoFor({ type: 'NAVIGA', url }), 1);
  assert.equal(L.costoFor({ type: 'LEGGI_PAGINA', scheda: 2 }), 0, 'la scheda aperta si legge senza uscire');
  assert.equal(L.costoFor({ type: 'LEGGI_PAGINA', url, _nonCompare: true }), 3);
  assert.equal(L.costoFor({ type: 'NAVIGA', url, _nonCompare: true }), 3);
});

test('coi dati della memoria dentro, l\'indirizzo scritto chiede un OK e non finisce nell\'elenco fisso', () => {
  const url = 'https://www.comune.bologna.it/quartieri/navile';
  for (const type of ['NAVIGA', 'LEGGI_PAGINA']) {
    const ing = L.ingressi({ type, url, _nonCompare: true, _exfilReason: 'contiene più dati presi dalla tua memoria/contesto' });
    assert.equal(ing.elenco, '', type);
    assert.equal(A.decide({ ...ing, livello: 'default', stato: 'contaminato' }), 'conferma', `${type}: il main la rende un OK`);
    assert.equal(A.decide({ ...ing, livello: 'automatico', stato: 'contaminato' }), 'chiede', type);
  }
});
