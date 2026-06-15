// Unit test per src/shared/feedbackThread.js — il parser che trasforma un
// feedback (segnalazione + note) nella sua conversazione a turni.
//
// È il cuore del fix #108 (parte 3): la dashboard deve mostrare la segnalazione,
// le risposte di Filo e le risposte dell'utente in BOX DIVERSI, non in un unico
// blocco. Questi test asseriscono che ogni pezzo del blob `notes` diventi il
// turno giusto, con il ruolo (lato/colore) giusto — senza Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackThread.js'));

const TH = globalThis.SN_FEEDBACK_THREAD;

test('si registra su globalThis con la sua API', () => {
  assert.ok(TH);
  assert.equal(typeof TH.parse, 'function');
  assert.equal(typeof TH.appendUserTurn, 'function');
  assert.equal(typeof TH.userTurnMarker, 'function');
});

test('feedback senza note → un solo turno: la segnalazione dell’utente', () => {
  const turns = TH.parse({ text: 'non funziona X', clientId: 'abc', createdAt: '2026-05-14T15:43:28.808Z' });
  assert.equal(turns.length, 1);
  assert.equal(turns[0].kind, 'report');
  assert.equal(turns[0].role, 'user'); // segnalazione di un tester umano
  assert.equal(turns[0].body, 'non funziona X');
  assert.equal(turns[0].ts, '2026-05-14T15:43:28.808Z');
});

test('segnalazione + nota di Filo → segnalazione (utente) poi nota (modello)', () => {
  const turns = TH.parse({
    text: 'manca il tasto copia',
    notes: 'Aggiunto il tasto copia al menu. Verificato con un test.',
    clientId: 'user-1',
  });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => [t.role, t.kind]), [
    ['user', 'report'],
    ['model', 'note'],
  ]);
  assert.match(turns[1].body, /tasto copia al menu/);
});

test('riapertura: nota di Filo + risposta dell’utente (storico "Riaperto il")', () => {
  const notes = [
    'Ho risolto come chiesto.',
    '',
    '--- Riaperto il 20/05/26, 19:37 ---',
    'No, manca ancora il caso con due immagini.',
  ].join('\n');
  const turns = TH.parse({ text: 'segnalazione', notes, clientId: 'user-1' });
  assert.equal(turns.length, 3);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'model', 'user']);
  assert.deepEqual(turns.map((t) => t.kind), ['report', 'note', 'reply']);
  assert.equal(turns[1].body, 'Ho risolto come chiesto.');
  assert.equal(turns[2].body, 'No, manca ancora il caso con due immagini.');
  assert.equal(turns[2].ts, '20/05/26, 19:37'); // ts estratto dal marcatore
});

test('più turni alternati Filo/utente in ordine cronologico', () => {
  const notes = [
    'Prima risposta di Filo.',
    '--- La tua risposta del 01/06/26, 10:00 ---',
    'Prima risposta utente.',
    '--- Riaperto il 02/06/26, 11:00 ---',
    'Seconda risposta utente.',
  ].join('\n');
  const turns = TH.parse({ text: 'orig', notes, clientId: 'u' });
  assert.deepEqual(turns.map((t) => `${t.role}:${t.kind}`), [
    'user:report',
    'model:note',
    'user:reply',
    'user:reply',
  ]);
  assert.equal(turns[2].body, 'Prima risposta utente.');
  assert.equal(turns[3].body, 'Seconda risposta utente.');
});

test('note che iniziano con un marcatore → nessun turno-Filo vuoto', () => {
  const notes = '--- Riaperto il 03/06/26 ---\nsolo una riapertura, niente nota prima';
  const turns = TH.parse({ text: 'orig', notes, clientId: 'u' });
  assert.equal(turns.length, 2);
  assert.deepEqual(turns.map((t) => t.kind), ['report', 'reply']);
});

test('feedback inviato da un AGENTE → segnalazione lato modello', () => {
  const turns = TH.parse({ text: 'area vuota', clientId: 'agent:gemini-3.1-flash-lite' });
  assert.equal(turns[0].role, 'model');
  assert.equal(turns[0].kind, 'report');
  assert.equal(TH.isFromModel('routine:notturna'), true);
  assert.equal(TH.isFromModel('101ff602-clientid'), false);
});

test('feedback vuoto → nessun turno (niente crash)', () => {
  assert.deepEqual(TH.parse({}), []);
  assert.deepEqual(TH.parse(null), []);
  assert.deepEqual(TH.parse({ text: '   ', notes: '   ' }), []);
});

test('appendUserTurn conserva lo storico ed è ri-parsabile', () => {
  const before = 'Domanda di Filo: quale provider?';
  const after = TH.appendUserTurn(before, 'Usa quello gratuito.', { ts: '05/06/26, 09:00' });
  assert.match(after, /Domanda di Filo/);
  assert.match(after, /Usa quello gratuito\./);
  // Il risultato deve riparsare in 2 turni (nota + risposta).
  const turns = TH.parse({ text: '', notes: after, clientId: 'u' });
  assert.deepEqual(turns.map((t) => t.kind), ['note', 'reply']);
  assert.equal(turns[1].body, 'Usa quello gratuito.');
  assert.equal(turns[1].ts, '05/06/26, 09:00');
});

test('appendUserTurn ignora una risposta vuota', () => {
  assert.equal(TH.appendUserTurn('x', '   '), 'x');
  assert.equal(TH.appendUserTurn('', ''), '');
});
