// #567 — com'è andata un'azione di Filo (src/shared/esitoAzione.js).
//
// Il feedback: la conversazione riaperta dalla Cronologia raccontava come
// riuscito tutto quello che Filo aveva soltanto nominato. Diceva «Ha cancellato
// la memoria» di una conferma mai data, «Ha eseguito un comando» di un comando
// mai partito, e «Ha proposto un evento» di un appuntamento già nel calendario.
// La causa era che dell'azione restava il solo nome. Qui si difende la regola
// che decide l'esito, una per il diario in diretta e per la chat riletta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/esitoAzione.js';

const E = globalThis.SN_ESITO;

test('un\'azione in attesa di conferma non è un\'azione fatta', () => {
  assert.equal(E.esitoAzione({ type: 'CANCELLA_MEMORIA', _confirm: { level: 3, text: 'x' } }), 'chiesto');
  assert.equal(E.conta('chiesto'), false);
});

test('un\'azione che non è partita è fallita, e il riassunto non la nomina', () => {
  assert.equal(E.esitoAzione({ type: 'ESEGUI_COMANDO', _executed: false, _output: { blocked: 'disabled' } }), 'fallito');
  assert.equal(E.esitoAzione({ type: 'IMPOSTA_PREFERENZA', _executed: false, _output: { pref: 'invalid' } }), 'fallito');
  assert.equal(E.conta('fallito'), false);
});

// La home chiesta dalla home: il sistema la segna eseguita perché non c'era
// niente da fare, ma «Ha azionato un comando della finestra» è una vanteria.
test('un comando della finestra che non ha mosso niente non si conta', () => {
  assert.equal(E.esitoAzione({ type: 'COMANDO_FINESTRA', _executed: true, _output: { already: true } }), 'fallito');
});

test('la proposta resta proposta finché l\'utente non clicca, e poi è compiuta', () => {
  const a = { type: 'EVENTO_CALENDARIO', _output: { proposta: true } };
  assert.equal(E.esitoAzione(a), 'proposto');
  a._output = { proposta: false, fatto: true };
  a._executed = true;
  assert.equal(E.esitoAzione(a), 'compiuto');
  assert.equal(E.conta('proposto'), true);
  assert.equal(E.conta('compiuto'), true);
});

// L'utente ha cliccato e il riordino non è potuto partire: il click c'è stato,
// ma l'azione no. Senza questo, il tentativo a vuoto si legge come riuscito.
test('il click che non porta a niente resta fallito', () => {
  const a = { type: 'PULISCI_TAB', _executed: false, _output: { proposta: false, fatto: false, ok: false } };
  assert.equal(E.esitoAzione(a), 'fallito');
});

test('un\'azione eseguita e basta è fatta', () => {
  assert.equal(E.esitoAzione({ type: 'SVEGLIA', _executed: true, _output: { ok: true } }), 'fatto');
  assert.equal(E.esitoAzione({ type: 'SVEGLIA' }), 'fatto');
});

// Le chat archiviate prima che l'esito esistesse tengono il solo nome: si
// leggono come si leggevano, invece di sparire dal racconto.
test('le azioni archiviate col solo nome restano leggibili', () => {
  assert.deepEqual(E.voci(['SVEGLIA', 'NAVIGA']), [
    { type: 'SVEGLIA', esito: 'fatto' },
    { type: 'NAVIGA', esito: 'fatto' },
  ]);
  assert.deepEqual(E.voci([{ type: 'TIMER', esito: 'chiesto' }]), [{ type: 'TIMER', esito: 'chiesto' }]);
  assert.deepEqual(E.voci([{ type: 'TIMER', esito: 'inventato' }]), [{ type: 'TIMER', esito: 'fatto' }]);
  assert.deepEqual(E.voci([{ esito: 'fatto' }, null, 'X']), [{ type: 'X', esito: 'fatto' }]);
  assert.deepEqual(E.voci(null), []);
});

test('valido() accetta solo gli esiti che esistono', () => {
  assert.equal(E.valido('compiuto'), true);
  assert.equal(E.valido('boh'), false);
  assert.equal(E.valido(''), false);
});
