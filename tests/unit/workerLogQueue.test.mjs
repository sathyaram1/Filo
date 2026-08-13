// Unit test per la fusione del registro dei worker (scripts/apply-triage.mjs).
//
// PERCHÉ ESISTE (feedback #451)
//   Il registro dei worker in dashboard è nato vuoto e vuoto è rimasto: lo
//   scriveva il dispatcher con una credenziale admin che le macchine delle
//   routine non hanno, in una funzione dichiaratamente silenziosa. Ora le voci
//   passano dalla coda su git e le applica la GitHub Action col service
//   account; questa è la parte che decide COSA finisce nel campo, e va tenuta
//   onesta: niente doppioni (la spedizione si ritenta), ordine cronologico, cap.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { mergeWorkerLog } = await import('../../scripts/apply-triage.mjs');

const voce = (role, startedAt, num = '') => ({ role, startedAt, num });

test('accoda in fondo mantenendo l\'ordine cronologico', () => {
  const out = mergeWorkerLog(
    [voce('prober', '2026-08-13T10:00:00.000Z')],
    [voce('new-work', '2026-08-13T11:00:00.000Z', '#22')],
  );
  assert.deepEqual(out.map((e) => e.role), ['prober', 'new-work']);
  assert.equal(out[1].num, '#22');
});

test('una voce arrivata in ritardo si mette al suo posto, non in fondo', () => {
  const out = mergeWorkerLog(
    [voce('verifier', '2026-08-13T12:00:00.000Z')],
    [voce('new-work', '2026-08-13T09:00:00.000Z')],
  );
  assert.deepEqual(out.map((e) => e.role), ['new-work', 'verifier']);
});

test('la stessa voce spedita due volte non viene contata due volte', () => {
  // La coda RITENTA le spedizioni non riuscite: senza questo, un guasto di rete
  // si trasformerebbe in worker fantasma nel registro dell'owner.
  const gia = [voce('fixer', '2026-08-13T10:00:00.000Z', '#30')];
  const out = mergeWorkerLog(gia, [voce('fixer', '2026-08-13T10:00:00.000Z', '#30')]);
  assert.equal(out.length, 1);
});

test('due worker diversi nello stesso istante restano due voci', () => {
  const out = mergeWorkerLog([], [
    voce('prober', '2026-08-13T10:00:00.000Z'),
    voce('verifier', '2026-08-13T10:00:00.000Z'),
  ]);
  assert.equal(out.length, 2);
});

test('il cap tiene le più recenti e taglia le più vecchie', () => {
  const current = Array.from({ length: 5 }, (_, i) => voce('prober', `2026-08-13T0${i}:00:00.000Z`));
  const out = mergeWorkerLog(current, [voce('new-work', '2026-08-13T09:00:00.000Z')], 3);
  assert.equal(out.length, 3);
  assert.equal(out[out.length - 1].role, 'new-work');
  assert.equal(out[0].startedAt, '2026-08-13T03:00:00.000Z');
});

test('voci malformate: scartate senza far saltare la fusione', () => {
  const out = mergeWorkerLog([null, {}, voce('prober', '2026-08-13T10:00:00.000Z')], [null, { num: '#1' }]);
  assert.deepEqual(out.map((e) => e.role), ['prober']);
});

test('registro mai scritto (nessun campo su Firestore): parte da zero', () => {
  const out = mergeWorkerLog(undefined, [voce('new-work', '2026-08-13T10:00:00.000Z')]);
  assert.deepEqual(out, [{ role: 'new-work', startedAt: '2026-08-13T10:00:00.000Z', num: '' }]);
});
