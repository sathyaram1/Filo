// I numeri assegnati a mano seguono la data d'arrivo, non l'ordine interno del
// database (#583, giro 7).
//
// Il comando che numera le segnalazioni rimaste senza numero promette una cosa
// sola: i numeri più bassi vanno alle segnalazioni arrivate prima. Finché
// l'ordine lo faceva il database quella promessa era gratis. Quando la lettura
// è passata a paginare col nome del documento, l'ordine è diventato un lavoro
// da fare qui, e il primo tentativo cercava la data in una forma che sui
// documenti veri non c'è: leggeva stringhe vuote, tutti i confronti davano
// zero, e i numeri uscivano nell'ordine degli identificativi, cioè a caso. Non
// se ne accorgeva nessuno, perché un numero sbagliato non si lamenta e non si
// riassegna più.
//
// Senza il fix questo file è ROSSO al primo caso.

import test from 'node:test';
import assert from 'node:assert/strict';

import { dataDiArrivo, ordinaPerArrivo } from '../../scripts/backfill-feedback-numbers.mjs';

const NOME = (id) => `projects/filo/databases/(default)/documents/feedback/${id}`;
const doc = (id, createdAt) => ({ name: NOME(id), fields: { createdAt } });
const ids = (docs) => docs.map((d) => String(d.name).split('/').pop());

test('la data d\'arrivo si legge in tutte le forme in cui Firestore la scrive', () => {
  const atteso = Date.parse('2026-01-01T10:00:00.000Z');
  assert.equal(dataDiArrivo(doc('a', { timestampValue: '2026-01-01T10:00:00.000Z' })), atteso);
  assert.equal(dataDiArrivo(doc('b', { stringValue: '2026-01-01T10:00:00.000Z' })), atteso);
  assert.equal(dataDiArrivo(doc('c', { integerValue: String(atteso) })), atteso);
  // Quello che non si legge deve DIRLO, non valere zero: zero è il 1970, e il
  // 1970 scavalca tutti.
  assert.ok(Number.isNaN(dataDiArrivo(doc('d', { booleanValue: true }))));
  assert.ok(Number.isNaN(dataDiArrivo({ name: NOME('e'), fields: {} })));
  assert.ok(Number.isNaN(dataDiArrivo(null)));
});

test('i numeri più bassi vanno alle segnalazioni arrivate prima, non ai primi identificativi', () => {
  // L'ordine per nome del documento è l'opposto di quello per data: è la
  // scena in cui un ordinamento che non funziona non si vede da nessuna parte.
  const ordinati = ordinaPerArrivo([
    doc('aaa', { timestampValue: '2026-03-03T10:00:00.000Z' }),
    doc('bbb', { timestampValue: '2026-02-02T10:00:00.000Z' }),
    doc('ccc', { timestampValue: '2026-01-01T10:00:00.000Z' }),
  ]);
  assert.deepEqual(ids(ordinati), ['ccc', 'bbb', 'aaa']);
});

test('date scritte in forme diverse si mettono in fila insieme', () => {
  const ordinati = ordinaPerArrivo([
    doc('recente', { timestampValue: '2026-06-01T00:00:00.000Z' }),
    doc('vecchio', { stringValue: '2025-06-01T00:00:00.000Z' }),
    doc('mezzo', { integerValue: String(Date.parse('2026-01-01T00:00:00.000Z')) }),
  ]);
  assert.deepEqual(ids(ordinati), ['vecchio', 'mezzo', 'recente']);
});

test('una data illeggibile va in fondo e non scavalca nessuno', () => {
  const ordinati = ordinaPerArrivo([
    doc('senza-data', {}),
    doc('recente', { timestampValue: '2026-06-01T00:00:00.000Z' }),
    doc('vecchio', { timestampValue: '2025-06-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(ids(ordinati), ['vecchio', 'recente', 'senza-data']);
});

test('a parità di data decide il nome, così due giri di fila danno lo stesso ordine', () => {
  const stessa = { timestampValue: '2026-02-02T10:00:00.000Z' };
  const uno = ids(ordinaPerArrivo([doc('zeta', stessa), doc('alfa', stessa)]));
  const due = ids(ordinaPerArrivo([doc('alfa', stessa), doc('zeta', stessa)]));
  assert.deepEqual(uno, ['alfa', 'zeta']);
  assert.deepEqual(due, ['alfa', 'zeta']);
});

test('l\'elenco di partenza non viene rimescolato sotto al chiamante', () => {
  const partenza = [
    doc('aaa', { timestampValue: '2026-03-03T10:00:00.000Z' }),
    doc('ccc', { timestampValue: '2026-01-01T10:00:00.000Z' }),
  ];
  const prima = ids(partenza);
  ordinaPerArrivo(partenza);
  assert.deepEqual(ids(partenza), prima);
});
