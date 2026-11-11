// #567 — l'esito del riordino delle schede come lo legge l'utente
// (esitoRiordino in src/pages/dashboard/dashboard-attivita.js).
//
// Il feedback: quando il giudizio sulle schede non arriva (crediti finiti,
// chiave sbagliata, rete giù) Filo rispondeva «Nessuna scheda da archiviare»,
// cioè la stessa frase di un riordino riuscito in cui non c'era niente da
// chiudere. Le tre strade che lo chiedono — bottone in chat, suggerimento
// della home, «/pulisci» — chiedono la frase qui: tre copie divergono, ed è
// così che il caso mai partito tornava a somigliare a quello riuscito.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/messages.js';
import '../../src/shared/esitoAzione.js';
import '../../src/shared/tabTriage.js';
import '../../src/shared/righeAttivita.js';
import '../../src/pages/dashboard/dashboard-attivita.js';

const { esitoRiordino } = globalThis.SN_DASH_ATTIVITA;

test('il riordino riuscito dice quante schede ha archiviato', () => {
  assert.deepEqual(esitoRiordino({ ok: true, archived: 3 }), {
    ok: true, motivo: '', testo: 'Archiviate 3 schede',
  });
  assert.equal(esitoRiordino({ ok: true, archived: 1 }).testo, 'Archiviate 1 scheda');
});

test('il riordino riuscito senza niente da chiudere lo dice, ed è un successo', () => {
  const e = esitoRiordino({ ok: true, archived: 0 });
  assert.equal(e.ok, true);
  assert.equal(e.testo, 'Nessuna scheda da archiviare');
});

test('senza il giudizio sulle schede l’esito non è quello di un riordino riuscito', () => {
  const e = esitoRiordino({ ok: true, archived: 0, giudizioMancato: true });
  assert.equal(e.ok, false);
  assert.equal(e.testo, 'Riordino non riuscito');
  assert.match(e.motivo, /valutare le schede/);
});

// Chi clicca due volte non ha ottenuto un secondo riordino: il primo stava
// ancora girando, e rispondergli «fatto» è la bugia di prima.
test('il riordino già in corso non si racconta come finito', () => {
  const e = esitoRiordino({ ok: true, archived: 0, giaInCorso: true });
  assert.equal(e.ok, false);
  assert.match(e.motivo, /già in corso/);
});

// #1626 — i doppioni li chiude Filo da sé, ma chi ha chiesto il riordino voleva le schede valutate: senza giudizio
// non è riuscito, lo dice col motivo del main e dice anche quanti doppioni ha chiuso.
test('senza giudizio il riordino non è riuscito anche se ha chiuso i doppioni, e il motivo è quello del main', () => {
  const e = esitoRiordino({ ok: true, archived: 2, giudizioMancato: true, error: 'Filo non è riuscito a valutare le schede: ha chiuso solo 2 doppioni. I crediti sono finiti.' });
  assert.equal(e.ok, false);
  assert.equal(e.testo, 'Chiusi solo 2 doppioni');
  assert.match(e.motivo, /crediti sono finiti\.$/);
  assert.equal(esitoRiordino({ ok: true, archived: 1, giudizioMancato: true }).testo, 'Chiusi solo un doppione');
});

test('in incognito il riordino non parte e lo dice', () => {
  const e = esitoRiordino({ ok: true, archived: 0, incognito: true });
  assert.equal(e.ok, false);
  assert.match(e.motivo, /incognito/);
});

test('una risposta mancante o negata è un riordino non riuscito', () => {
  assert.equal(esitoRiordino(null).ok, false);
  assert.equal(esitoRiordino({ ok: false, archived: 0 }).ok, false);
});

test('senza la frase del main, la home dice il perché con la sua stessa regola, motivo compreso', () => {
  const T = globalThis.SN_TAB_TRIAGE;
  for (const r of [{ incognito: true }, { giaInCorso: true }, { giudizioMancato: true, motivo: 'I crediti sono finiti' }]) {
    assert.equal(esitoRiordino(r).motivo, T.riordinoNonRiuscito(r));
  }
  assert.match(esitoRiordino({ giudizioMancato: true, archived: 2, motivo: 'I crediti sono finiti' }).motivo, /crediti sono finiti/);
});
