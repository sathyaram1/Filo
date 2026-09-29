// Chat per mazzo del deck builder (#787, src/shared/deckChat.js): cosa di una bolla si conserva e come si rilegge.
// La prova che conta: la chat salvata e riletta dà al modello lo stesso storico di prima della ricarica.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../src/shared/deckChat.js';

const C = globalThis.SN_DECK_CHAT;

const conversazione = () => [
  { who: 'user', text: 'draghi rossi' },
  {
    who: 'bot', reply: 'Eccone due, guarda [[Shivan Dragon]].', cardIds: ['a', 'b'], query: 't:dragon c:r',
    reasoning: 'cerco draghi', expanded: true, cotOpen: true, _i: 1, nameIds: { 'shivan dragon': 'b' },
  },
  { who: 'user', text: 'importa 37 Forest' },
  { who: 'bot', reply: '', cardIds: ['f'], importQty: { f: 37, x: 0 }, importCommanderId: '', imported: true },
  { who: 'user', text: 'e adesso?' },
  { who: 'bot', error: 'il servizio non risponde. Riprova.', reasoning: 'boh' },
];

test('si conserva il contenuto, non lo stato di vista', () => {
  const saved = C.cleanChat(conversazione());
  assert.equal(saved.length, 6);
  const bot = saved[1];
  assert.deepEqual(bot, {
    who: 'bot', reasoning: 'cerco draghi', nameIds: { 'shivan dragon': 'b' },
    reply: 'Eccone due, guarda [[Shivan Dragon]].', cardIds: ['a', 'b'], query: 't:dragon c:r',
  });
  // «Già aggiunte» si ricava dal mazzo di adesso: un vecchio segno salvato non si porta dietro.
  assert.deepEqual(saved[3], { who: 'bot', cardIds: ['f'], importQty: { f: 37 } });
  assert.deepEqual(saved[5], { who: 'bot', reasoning: 'boh', error: 'il servizio non risponde. Riprova.' });
});

test('riletta, la chat dà al modello lo stesso storico di prima', () => {
  const prima = conversazione();
  const dopo = C.cleanChat(JSON.parse(JSON.stringify(C.cleanChat(prima))));
  assert.deepEqual(C.historyFor(dopo), C.historyFor(prima));
  assert.deepEqual(C.historyFor(dopo), [
    { role: 'user', content: 'draghi rossi' },
    { role: 'assistant', content: 'Eccone due, guarda [[Shivan Dragon]].' },
    { role: 'user', content: 'importa 37 Forest' },
    { role: 'user', content: 'e adesso?' },
  ]);
});

test('una risposta ancora in volo si rilegge come interrotta, mai come «sta pensando»', () => {
  const saved = C.cleanChat([
    { who: 'user', text: 'cerca' },
    { who: 'bot', pending: true, reasoning: 'sto pens' },
  ]);
  assert.deepEqual(saved[1], { who: 'bot', reasoning: 'sto pens', interrupted: true });
  assert.equal(saved.some((m) => m.pending), false);
  // Rilettura della rilettura: resta interrotta, non diventa una risposta vuota.
  assert.deepEqual(C.cleanChat(saved)[1], saved[1]);
});

test('roba che non è una bolla non entra', () => {
  const saved = C.cleanChat([
    null, 'testo', 42, { who: 'sistema', text: 'x' }, { who: 'user', text: '' }, { who: 'user', text: 7 },
    { who: 'bot', cardIds: ['ok', 3, '', null], importQty: [1, 2], nameIds: { a: 5, b: 'id-b' } },
  ]);
  assert.deepEqual(saved, [{ who: 'bot', cardIds: ['ok'], nameIds: { b: 'id-b' } }]);
  assert.deepEqual(C.cleanChat(undefined), []);
  assert.deepEqual(C.cleanChat({ messages: [] }), []);
});

test('il testo non si accorcia, per quanto lungo', () => {
  const lungo = 'x'.repeat(200_000);
  const saved = C.cleanChat([{ who: 'user', text: lungo }, { who: 'bot', reply: lungo, reasoning: lungo }]);
  assert.equal(saved[0].text.length, 200_000);
  assert.equal(saved[1].reply.length, 200_000);
  assert.equal(saved[1].reasoning.length, 200_000);
});

test('le carte da caricare partono dalla bolla più recente, senza doppioni', () => {
  assert.deepEqual(C.cardIdsOf([
    { who: 'bot', cardIds: ['a', 'b'], nameIds: { x: 'c' } },
    { who: 'user', text: 'altro' },
    { who: 'bot', cardIds: ['d', 'a'], importCommanderId: 'e' },
  ]), ['d', 'a', 'e', 'b', 'c']);
  assert.deepEqual(C.cardIdsOf(null), []);
});

test('il tetto è largo e si conta per messaggi', () => {
  assert.ok(C.MAX_MESSAGES >= 2000);
  assert.equal(C.fits(new Array(C.MAX_MESSAGES).fill({ who: 'user', text: 'a' })), true);
  assert.equal(C.fits(new Array(C.MAX_MESSAGES + 1).fill({ who: 'user', text: 'a' })), false);
});

test('una risposta in volo col suo turno si rilegge «sta pensando» solo finché qualcuno la aspetta', () => {
  const saved = C.cleanChat([{ who: 'user', text: 'cerca' }, { who: 'bot', pending: true, turn: 't1', cotOpen: true }]);
  assert.deepEqual(saved[1], { who: 'bot', turn: 't1', pending: true });
  assert.deepEqual(C.forReading(saved, (t) => t === 't1')[1], { who: 'bot', turn: 't1', pending: true });
  assert.deepEqual(C.forReading(saved, () => false)[1], { who: 'bot', turn: 't1', interrupted: true });
  assert.deepEqual(C.forReading(saved)[1], { who: 'bot', turn: 't1', interrupted: true });
});

test('ogni scheda applica la sua modifica alla chat salvata, senza riscriverla', () => {
  const base = [{ who: 'user', text: 'a' }, { who: 'bot', pending: true, turn: 't1' }];
  // Intanto un'altra scheda ha aggiunto la sua domanda: la risposta attesa entra al suo posto, l'altra resta.
  const conAltra = C.applyEdit(base, { op: 'append', messages: [{ who: 'user', text: 'b' }, { who: 'bot', pending: true, turn: 't2' }] }).list;
  const riempita = C.applyEdit(conAltra, { op: 'fill', turn: 't1', message: { who: 'bot', reply: 'A', pending: false, turn: 't1', expanded: true } }).list;
  assert.deepEqual(riempita.map((m) => m.text || m.reply || (m.pending && 'attesa')), ['a', 'A', 'b', 'attesa']);
  assert.equal(riempita[1].pending, undefined);
  // Svuotata nel frattempo: la risposta non ha più dove entrare.
  assert.deepEqual(C.applyEdit([], { op: 'fill', turn: 't1', message: { reply: 'A' } }), { error: 'gone' });
  assert.deepEqual(C.applyEdit(base, { op: 'boh' }), { error: 'bad_op' });
});
