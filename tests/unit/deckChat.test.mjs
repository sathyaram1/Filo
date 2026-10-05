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

test('la richiesta di svuotare a parole resta nella bolla, anche dopo la risposta scritta al suo turno', () => {
  const [bot] = C.cleanChat([{ who: 'bot', turn: 't1', reply: 'Svuoto la chat di questo mazzo?', clearChat: true }]);
  assert.equal(bot.clearChat, true);
  const r = C.applyEdit([{ who: 'user', text: 'svuota la chat' }, { who: 'bot', turn: 't1', pending: true }],
    { op: 'fill', turn: 't1', message: { who: 'bot', reply: 'Svuoto la chat di questo mazzo?', clearChat: true } });
  assert.equal(r.list[1].clearChat, true);
  assert.equal(C.cleanChat([{ who: 'bot', reply: 'x', clearChat: 'true' }])[0].clearChat, undefined);
});

test('le carte che il giudice non ha potuto guardare restano segnate, solo fra quelle della lista (#382)', () => {
  const [bot] = C.cleanChat([{ who: 'bot', reply: 'x', cardIds: ['a', 'b', 'c'], uncheckedIds: ['b', 'z', '', 3] }]);
  assert.deepEqual(bot.uncheckedIds, ['b']);
  const [senza] = C.cleanChat([{ who: 'bot', reply: 'x', cardIds: ['a'], uncheckedIds: ['z'] }]);
  assert.equal('uncheckedIds' in senza, false);
});

// #788 — la riga di sintesi di una lista: titolo leggibile del modello, ordine scelto dall'utente, tutti e due salvati.
test('titolo e ordine di una lista si salvano con la lista, il default no', () => {
  const [bot] = C.cleanChat([{ who: 'bot', turn: 't1', cardIds: ['a', 'b'], title: '  carte che\n danno rapidità ', sort: 'price' }]);
  assert.equal(bot.title, 'carte che danno rapidità');
  assert.equal(bot.sort, 'price');
  const [cmc] = C.cleanChat([{ who: 'bot', cardIds: ['a'], sort: 'cmc' }]);
  assert.equal('sort' in cmc, false);
  const [strano] = C.cleanChat([{ who: 'bot', cardIds: ['a'], sort: 'colore', title: 42 }]);
  assert.equal('sort' in strano, false);
  assert.equal('title' in strano, false);
  // Senza carte non c'è lista: niente titolo né ordine.
  const [vuota] = C.cleanChat([{ who: 'bot', reply: 'x', title: 'carte', sort: 'name' }]);
  assert.deepEqual(vuota, { who: 'bot', reply: 'x' });
});

test('cambiare l\'ordine di una lista è una modifica sola, sul suo turno', () => {
  const base = [{ who: 'user', text: 'haste' }, { who: 'bot', turn: 't1', cardIds: ['a', 'b'], query: 'o:haste' }];
  const r = C.applyEdit(base, { op: 'sort', turn: 't1', sort: 'name' });
  assert.equal(r.list[1].sort, 'name');
  assert.deepEqual(r.list[1].cardIds, ['a', 'b']);
  const back = C.applyEdit(r.list, { op: 'sort', turn: 't1', sort: 'cmc' });
  assert.equal('sort' in back.list[1], false);
  assert.deepEqual(C.applyEdit(base, { op: 'sort', turn: 't9', sort: 'name' }), { error: 'gone' });
  assert.deepEqual(C.applyEdit(base, { op: 'sort', turn: 't1', sort: 'boh' }), { error: 'bad_sort' });
});

test('le righe si ordinano per costo, nome o prezzo; senza prezzo in fondo', () => {
  const cards = {
    a: { name: 'Zap', cmc: 3, priceEur: 0.5 },
    b: { name: 'apex', cmc: 1, priceEur: null },
    c: { name: 'Bolt', cmc: 1, priceEur: 2 },
  };
  assert.deepEqual(C.sortIds(['a', 'b', 'c'], cards, 'cmc'), ['b', 'c', 'a']);
  assert.deepEqual(C.sortIds(['a', 'b', 'c'], cards, undefined), ['b', 'c', 'a']);
  assert.deepEqual(C.sortIds(['a', 'b', 'c'], cards, 'name'), ['b', 'c', 'a']);
  assert.deepEqual(C.sortIds(['a', 'b', 'c'], cards, 'price'), ['a', 'c', 'b']);
  // Le carte non ancora caricate non rompono niente.
  assert.deepEqual(C.sortIds(['x', 'a'], cards, 'price'), ['a', 'x']);
  const ids = ['a', 'b'];
  C.sortIds(ids, cards, 'name');
  assert.deepEqual(ids, ['a', 'b'], 'la lista salvata non si riordina sotto i piedi');
});

test('la riga di sintesi dice il numero e la frase, mai la query', () => {
  assert.equal(C.listLabel(12, 'carte che danno rapidità'), '12 carte che danno rapidità');
  assert.equal(C.listLabel(12, ''), '12 risultati');
  assert.equal(C.listLabel(1, undefined), '1 risultato');
  assert.equal(C.listLabel(1, 'carte che danno rapidità'), '1 risultato: carte che danno rapidità');
  // Il numero lo mette il sistema: quello del modello (spesso sbagliato, conta prima del filtro) non si raddoppia.
  assert.equal(C.listLabel(7, '12 carte che danno rapidità'), '7 carte che danno rapidità');
});
