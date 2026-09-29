// Magazzino e canale della chat per mazzo (#787): src/main/services/deckChats.js e gli handler DECKS_CHAT_* /
// DECKS_DELETE di src/main/services/handlers/decks.js. Niente Electron: chrome.storage.local finto in memoria con
// la SCRITTURA lenta, che è dove due salvataggi insieme si mangiano a vicenda.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'shared', 'deckChat.js'));
const { MSG } = globalThis.SN_MSG;
const KEY = globalThis.SN_CONST.STORAGE_KEYS.DECK_CHATS;

let disco = {};
let ritardoScrittura = 0;
globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return { [key]: disco[key] === undefined ? undefined : JSON.parse(JSON.stringify(disco[key])) }; },
      async set(obj) {
        if (ritardoScrittura) await new Promise((r) => setTimeout(r, ritardoScrittura));
        Object.assign(disco, JSON.parse(JSON.stringify(obj)));
      },
    },
  },
};

const mazzi = new Set();
globalThis.SN_DECK_STORE = {
  get: async (id) => (mazzi.has(id) ? { id, carte: [] } : null),
  remove: async (id) => mazzi.delete(id),
};
globalThis.SN_DECK_OPINIONS_SVC = { dropDeck: async () => {} };

require(join(ROOT, 'src', 'main', 'services', 'deckChats.js'));
const Chats = globalThis.SN_DECK_CHATS_SVC;

const handlers = new Map();
const avvisi = [];
require(join(ROOT, 'src', 'main', 'services', 'handlers', 'decks.js'))(
  (type, fn) => handlers.set(type, fn),
  { MSG, handleAIRequest: async () => ({ text: '{}' }), broadcastToFiloPages: (m) => avvisi.push(m) },
);
const PAGINA = 'filo://decks/decks.html#/deck/d1';
const call = (type, msg, origin = PAGINA) => handlers.get(type)({ type, ...msg }, {}, origin);

const turno = (q, a) => [{ who: 'user', text: q }, { who: 'bot', reply: a, cardIds: ['c-' + q], turn: 't-' + q }];
const aggiungi = (deckId, messages, opts) => Chats.edit(deckId, { op: 'append', messages }, opts);
// Una pagina finta: basta che sappia avvisare di una navigazione o della chiusura.
function paginaFinta() {
  const ascolta = new Map();
  return {
    on(ev, fn) { ascolta.set(ev, [...(ascolta.get(ev) || []), fn]); },
    once(ev, fn) { this.on(ev, fn); },
    removeListener(ev, fn) { ascolta.set(ev, (ascolta.get(ev) || []).filter((f) => f !== fn)); },
    emit(ev, ...a) { for (const fn of ascolta.get(ev) || []) fn(...a); },
    ascoltatori() { return [...ascolta.values()].reduce((n, l) => n + l.length, 0); },
  };
}

beforeEach(() => {
  disco = {};
  ritardoScrittura = 0;
  mazzi.clear();
  mazzi.add('d1');
  mazzi.add('d2');
  avvisi.length = 0;
});

test('salvata e riletta: ogni mazzo ha la sua chat', async () => {
  assert.deepEqual(await call(MSG.DECKS_CHAT_EDIT, { deckId: 'd1', op: 'append', messages: turno('uno', 'A'), clientId: 'tab1' }), { ok: true });
  await call(MSG.DECKS_CHAT_EDIT, { deckId: 'd2', op: 'append', messages: turno('due', 'B') });
  const r1 = await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' });
  const r2 = await call(MSG.DECKS_CHAT_GET, { deckId: 'd2' });
  assert.deepEqual(r1.messages.map((m) => m.text || m.reply), ['uno', 'A']);
  assert.deepEqual(r2.messages.map((m) => m.text || m.reply), ['due', 'B']);
  // Le altre schede lo sanno, con chi l'ha scritto (quella non si rilegge da sola).
  assert.deepEqual(avvisi[0], { type: MSG.DECKS_CHAT_CHANGED, deckId: 'd1', clientId: 'tab1' });
});

test('due schede che scrivono nello stesso istante: restano tutte e due le domande', async () => {
  ritardoScrittura = 5;
  await Promise.all([
    aggiungi('d1', turno('uno', 'A')),
    aggiungi('d2', turno('due', 'B')),
    aggiungi('d1', turno('tre', 'C')),
  ]);
  assert.deepEqual((await Chats.get('d1')).map((m) => m.text || m.reply), ['uno', 'A', 'tre', 'C']);
  assert.equal((await Chats.get('d2')).length, 2);
});

test('eliminato il mazzo, la sua chat non resta nei dati salvati', async () => {
  await aggiungi('d1', turno('uno', 'A'));
  await aggiungi('d2', turno('due', 'B'));
  assert.deepEqual(await call(MSG.DECKS_DELETE, { id: 'd1' }), { ok: true });
  assert.equal(disco[KEY].d1, undefined);
  assert.equal(disco[KEY].d2.messages.length, 2);
});

test('una risposta che arriva dopo l\'eliminazione del mazzo non fa rinascere la chat', async () => {
  ritardoScrittura = 5;
  await aggiungi('d1', [{ who: 'user', text: 'uno' }, { who: 'bot', pending: true, turn: 't1' }]);
  // La risposta parte, il mazzo sparisce nel frattempo: comunque vada l'ordine, alla fine non c'è niente.
  const tardi = Chats.edit('d1', { op: 'fill', turn: 't1', message: { reply: 'A' } });
  const via = call(MSG.DECKS_DELETE, { id: 'd1' });
  await Promise.all([tardi, via]);
  assert.equal(disco[KEY].d1, undefined);
  // E una che arriva dopo viene rifiutata.
  assert.deepEqual(await aggiungi('d1', turno('tre', 'C')), { ok: false, error: 'not_found' });
  assert.equal(disco[KEY].d1, undefined);
});

test('svuotare la chat la toglie dai dati, e resta vuota', async () => {
  await aggiungi('d1', turno('uno', 'A'));
  assert.deepEqual(await call(MSG.DECKS_CHAT_CLEAR, { deckId: 'd1', clientId: 'tab1' }), { ok: true });
  assert.equal(disco[KEY].d1, undefined);
  assert.deepEqual((await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' })).messages, []);
  assert.equal(avvisi.at(-1).type, MSG.DECKS_CHAT_CHANGED);
});

test('svuotata mentre un\'altra scheda aspetta Filo: la risposta non riporta indietro la conversazione', async () => {
  await aggiungi('d1', turno('uno', 'A'));
  await aggiungi('d1', [{ who: 'user', text: 'due' }, { who: 'bot', pending: true, turn: 't2' }], { wc: paginaFinta() });
  await call(MSG.DECKS_CHAT_CLEAR, { deckId: 'd1' });
  const r = await call(MSG.DECKS_CHAT_EDIT, { deckId: 'd1', op: 'fill', turn: 't2', message: { reply: 'B' } });
  assert.deepEqual(r, { ok: false, error: 'gone' });
  assert.equal(disco[KEY].d1, undefined);
  assert.equal(Chats.isLive('t2'), false);
});

test('una risposta attesa da una pagina aperta si rilegge «sta pensando», poi completa al suo posto', async () => {
  const pagina = paginaFinta();
  await aggiungi('d1', [{ who: 'user', text: 'cerca' }, { who: 'bot', pending: true, turn: 't1' }], { wc: pagina });
  assert.deepEqual((await Chats.get('d1'))[1], { who: 'bot', turn: 't1', pending: true });
  // Un'altra scheda scrive intanto: la sua domanda resta, la risposta attesa entra al posto giusto.
  await aggiungi('d1', turno('altro', 'X'));
  await Chats.edit('d1', { op: 'fill', turn: 't1', message: { reply: 'Eccole', cardIds: ['a'], pending: false } });
  assert.deepEqual((await Chats.get('d1')).map((m) => m.text || m.reply), ['cerca', 'Eccole', 'altro', 'X']);
  assert.equal(Chats.isLive('t1'), false);
  assert.equal(pagina.ascoltatori(), 0);
});

test('la pagina che aspettava si ricarica o si chiude: la risposta si rilegge interrotta, e le altre lo sanno', async () => {
  for (const come of ['ricarica', 'chiude', 'cambia hash']) {
    avvisi.length = 0;
    const pagina = paginaFinta();
    const turn = `t-${come}`;
    const domanda = [{ who: 'user', text: come }, { who: 'bot', pending: true, turn }];
    await aggiungi('d1', domanda, { wc: pagina, onAbandon: () => avvisi.push('abbandonata') });
    if (come === 'ricarica') pagina.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
    else if (come === 'chiude') pagina.emit('destroyed');
    else pagina.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
    const last = (await Chats.get('d1')).at(-1);
    if (come === 'cambia hash') {
      assert.equal(last.pending, true, 'un cambio di hash è la stessa pagina che aspetta ancora');
      await Chats.edit('d1', { op: 'fill', turn, message: { reply: 'ok' } });
      assert.equal(pagina.ascoltatori(), 0);
    } else {
      assert.deepEqual(last, { who: 'bot', turn, interrupted: true }, come);
      assert.deepEqual(avvisi.filter((a) => a === 'abbandonata'), ['abbandonata'], come);
      assert.equal(pagina.ascoltatori(), 0);
    }
  }
});

test('una risposta in volo senza pagina che la aspetta si salva e si rilegge interrotta', async () => {
  await aggiungi('d1', [{ who: 'user', text: 'cerca' }, { who: 'bot', pending: true }]);
  assert.deepEqual((await Chats.get('d1'))[1], { who: 'bot', interrupted: true });
});

test('Riprova toglie la risposta fallita e la sua domanda, anche quelle salvate senza turno', async () => {
  await aggiungi('d1', [...turno('uno', 'A'), { who: 'user', text: 'due' }, { who: 'bot', error: 'boh', turn: 't2' }]);
  await Chats.edit('d1', { op: 'drop', turn: 't2', userText: 'due' });
  assert.deepEqual((await Chats.get('d1')).map((m) => m.text || m.reply), ['uno', 'A']);
  await aggiungi('d1', [{ who: 'user', text: 'tre' }, { who: 'bot', interrupted: true }]);
  await Chats.edit('d1', { op: 'drop', turn: '', userText: 'tre' });
  assert.deepEqual((await Chats.get('d1')).map((m) => m.text || m.reply), ['uno', 'A']);
});

test('i nomi in prosa risolti si aggiungono alla loro bolla', async () => {
  await aggiungi('d1', turno('uno', 'Guarda [[Sol Ring]] e [[Mana Crypt]]'));
  await Chats.edit('d1', { op: 'names', turn: 't-uno', nameIds: { 'sol ring': 's1' } });
  await Chats.edit('d1', { op: 'names', turn: 't-uno', nameIds: { 'mana crypt': 'm1' } });
  assert.deepEqual((await Chats.get('d1'))[1].nameIds, { 'sol ring': 's1', 'mana crypt': 'm1' });
});

test('oltre il tetto una domanda nuova si rifiuta col numero, e la chat salvata resta quella di prima', async () => {
  await aggiungi('d1', turno('uno', 'A'));
  const troppi = [];
  for (let i = 0; i < globalThis.SN_DECK_CHAT.MAX_MESSAGES - 1; i += 1) troppi.push({ who: 'user', text: `m${i}` });
  const r = await call(MSG.DECKS_CHAT_EDIT, { deckId: 'd1', op: 'append', messages: troppi });
  assert.deepEqual(r, { ok: false, error: 'too_many', max: globalThis.SN_DECK_CHAT.MAX_MESSAGES });
  assert.equal(disco[KEY].d1.messages.length, 2);
});

test('il canale risponde solo alle pagine di Filo', async () => {
  await aggiungi('d1', turno('uno', 'A'));
  for (const origin of ['https://sito.example/', '', 'file:///x.html']) {
    assert.deepEqual(await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' }, origin), { ok: false, error: 'forbidden' });
    assert.deepEqual(await call(MSG.DECKS_CHAT_EDIT, { deckId: 'd1', op: 'append', messages: turno('x', 'y') }, origin), { ok: false, error: 'forbidden' });
    assert.deepEqual(await call(MSG.DECKS_CHAT_CLEAR, { deckId: 'd1' }, origin), { ok: false, error: 'forbidden' });
  }
  assert.equal(disco[KEY].d1.messages.length, 2);
});
