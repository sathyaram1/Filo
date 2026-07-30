// Unit test per la PROPOSTA di segnalazione (#360) — logica pura in
// src/shared/autoFeedback.js.
//
// Il feedback #360: "dopo che gli ho chiesto quanti crediti avessi non solo non
// lo sapeva ma sopratutto NON ha proposto un feedback (lo ha fatto solo dopo che
// gli ho chiesto di farlo)". Qui si verifica la parte deterministica: la
// risposta "non ho accesso al saldo…" viene riconosciuta come mancanza, e da
// quella nasce una segnalazione già scritta che cita la richiesta dell'utente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/autoFeedback.js');
const AF = globalThis.SN_AUTO_FEEDBACK;

const CAPS = [
  { id: 'salva-pagina', title: 'Salva pagina', category: 'save', desc: '', invoke: '' },
];

// Il caso reale del feedback: la risposta di Filo alla domanda sui crediti.
const CREDITI_REPLY =
  'Non ho accesso al saldo dei crediti: puoi vederlo in Opzioni, alla voce Crediti e consumi.';

test('la risposta "non ho accesso a…" è riconosciuta come mancanza', () => {
  const a = AF.analyzeReply(CREDITI_REPLY, [], 'quanti crediti ho?', CAPS);
  assert.equal(a.kind, 'capability-gap');
});

test('altre ammissioni di non avere un dato sono riconosciute', () => {
  const frasi = [
    'Non posso vedere quante schede hai aperto in questo momento, mi spiace.',
    'Non ho modo di sapere quanto hai speso finora con i modelli AI.',
    'Non riesco a recuperare la cronologia delle tue chiamate al servizio.',
    'Non ho visibilità su quello che succede nelle altre finestre di Filo.',
  ];
  for (const r of frasi) {
    assert.equal(AF.analyzeReply(r, [], 'una domanda', CAPS).kind, 'capability-gap', r);
  }
});

test('una risposta normale non diventa una mancanza (niente proposte a caso)', () => {
  const frasi = [
    'Ho aperto la pagina che mi hai chiesto, dimmi se ti serve altro.',
    'Il timer da dieci minuti è partito: lo trovi nella colonna a destra.',
    'Ci sono tre schede aperte in questo momento, due su Wikipedia e una su GitHub.',
  ];
  for (const r of frasi) {
    assert.equal(AF.analyzeReply(r, [], 'ciao', CAPS).kind, null, r);
  }
});

test('composeProposal → azione INVIA_FEEDBACK che cita la richiesta e l\'ammissione', () => {
  const a = AF.analyzeReply(CREDITI_REPLY, [], 'quanti crediti ho?', CAPS);
  const p = AF.composeProposal(a, { userMessage: 'quanti crediti ho?', textReply: CREDITI_REPLY });
  assert.ok(p, 'nessuna proposta composta');
  assert.equal(p.type, 'INVIA_FEEDBACK');
  // Cita cosa l'utente aveva chiesto: senza questo la segnalazione è inutile.
  assert.match(p.testo, /quanti crediti ho/i);
  // Cita cosa Filo ha risposto: dice a chi sviluppa DOVE è il confine.
  assert.match(p.testo, /non ho accesso al saldo/i);
  // Titolo breve e non vuoto.
  assert.ok(p.titolo.length > 0 && p.titolo.length <= 60, `titolo strano: ${p.titolo}`);
});

test('composeProposal: titolo di 2-6 parole ricavato dalla richiesta', () => {
  const a = { kind: 'capability-gap', genericDesc: 'x' };
  const p = AF.composeProposal(a, {
    userMessage: 'puoi mostrarmi tutti i grafici della mia spesa mensile divisa per modello, per favore?',
    textReply: 'Non ho accesso a questi dati in forma di grafico.',
  });
  assert.ok(p.titolo.split(' ').length <= 6, `troppe parole: ${p.titolo}`);
});

test('composeProposal: niente proposta senza la richiesta dell\'utente', () => {
  const a = { kind: 'capability-gap', genericDesc: 'x' };
  assert.equal(AF.composeProposal(a, { userMessage: '', textReply: CREDITI_REPLY }), null);
  assert.equal(AF.composeProposal(a, {}), null);
});

test('composeProposal: nessun segnale → nessuna proposta', () => {
  assert.equal(AF.composeProposal({ kind: null }, { userMessage: 'ciao' }), null);
  assert.equal(AF.composeProposal(null, { userMessage: 'ciao' }), null);
});

test('composeProposal: una lamentela diventa una segnalazione di malfunzionamento', () => {
  const reply = 'Si è verificato un errore mentre salvavo il file, non è stato scritto niente.';
  const a = AF.analyzeReply(reply, [], 'salva questo appunto', CAPS);
  assert.equal(a.kind, 'complaint');
  const p = AF.composeProposal(a, { userMessage: 'salva questo appunto', textReply: reply });
  assert.equal(p.type, 'INVIA_FEEDBACK');
  assert.match(p.testo, /salva questo appunto/i);
});

test('composeProposal: richieste lunghissime vengono troncate, non passate intere', () => {
  const lungo = `voglio che tu ${'x'.repeat(3000)}`;
  const p = AF.composeProposal({ kind: 'capability-gap' }, { userMessage: lungo, textReply: CREDITI_REPLY });
  assert.ok(p.testo.length <= 1500, `testo troppo lungo: ${p.testo.length}`);
});

test('la segnalazione anonima generica resta senza testo dell\'utente', () => {
  // compose() è l'altro canale (invio silenzioso): lì la privacy vale ancora e
  // il testo dell'utente NON deve comparire.
  const a = AF.analyzeReply(CREDITI_REPLY, [], 'quanti crediti ho?', CAPS);
  const payload = AF.compose(a);
  assert.ok(!/quanti crediti ho/i.test(payload.text), payload.text);
});
