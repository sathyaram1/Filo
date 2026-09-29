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

const turno = (q, a) => [{ who: 'user', text: q }, { who: 'bot', reply: a, cardIds: ['c-' + q] }];

beforeEach(() => {
  disco = {};
  ritardoScrittura = 0;
  mazzi.clear();
  mazzi.add('d1');
  mazzi.add('d2');
  avvisi.length = 0;
});

test('salvata e riletta: ogni mazzo ha la sua chat', async () => {
  assert.deepEqual(await call(MSG.DECKS_CHAT_SAVE, { deckId: 'd1', messages: turno('uno', 'A'), clientId: 'tab1' }), { ok: true });
  await call(MSG.DECKS_CHAT_SAVE, { deckId: 'd2', messages: turno('due', 'B') });
  const r1 = await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' });
  const r2 = await call(MSG.DECKS_CHAT_GET, { deckId: 'd2' });
  assert.deepEqual(r1.messages.map((m) => m.text || m.reply), ['uno', 'A']);
  assert.deepEqual(r2.messages.map((m) => m.text || m.reply), ['due', 'B']);
  // Le altre schede lo sanno, con chi l'ha scritto (quella non si rilegge da sola).
  assert.deepEqual(avvisi[0], { type: MSG.DECKS_CHAT_CHANGED, deckId: 'd1', clientId: 'tab1' });
});

test('due mazzi salvati nello stesso istante restano entrambi', async () => {
  ritardoScrittura = 5;
  await Promise.all([
    Chats.save('d1', turno('uno', 'A')),
    Chats.save('d2', turno('due', 'B')),
    Chats.save('d1', [...turno('uno', 'A'), ...turno('tre', 'C')]),
  ]);
  assert.equal((await Chats.get('d1')).length, 4);
  assert.equal((await Chats.get('d2')).length, 2);
});

test('eliminato il mazzo, la sua chat non resta nei dati salvati', async () => {
  await Chats.save('d1', turno('uno', 'A'));
  await Chats.save('d2', turno('due', 'B'));
  assert.deepEqual(await call(MSG.DECKS_DELETE, { id: 'd1' }), { ok: true });
  assert.equal(disco[KEY].d1, undefined);
  assert.equal(disco[KEY].d2.messages.length, 2);
});

test('una risposta che arriva dopo l\'eliminazione del mazzo non fa rinascere la chat', async () => {
  ritardoScrittura = 5;
  await Chats.save('d1', turno('uno', 'A'));
  // Il salvataggio parte, il mazzo sparisce nel frattempo: comunque vada l'ordine, alla fine non c'è niente.
  const tardi = Chats.save('d1', [...turno('uno', 'A'), ...turno('due', 'B')]);
  const via = call(MSG.DECKS_DELETE, { id: 'd1' });
  await Promise.all([tardi, via]);
  assert.equal(disco[KEY].d1, undefined);
  // E uno che parte dopo viene rifiutato.
  assert.deepEqual(await Chats.save('d1', turno('tre', 'C')), { ok: false, error: 'not_found' });
  assert.equal(disco[KEY].d1, undefined);
});

test('svuotare la chat la toglie dai dati, e resta vuota', async () => {
  await Chats.save('d1', turno('uno', 'A'));
  assert.deepEqual(await call(MSG.DECKS_CHAT_CLEAR, { deckId: 'd1', clientId: 'tab1' }), { ok: true });
  assert.equal(disco[KEY].d1, undefined);
  assert.deepEqual((await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' })).messages, []);
  assert.equal(avvisi.at(-1).type, MSG.DECKS_CHAT_CHANGED);
  // Salvare una chat vuota vale come svuotarla.
  await Chats.save('d2', turno('due', 'B'));
  await Chats.save('d2', []);
  assert.equal(disco[KEY].d2, undefined);
});

test('oltre il tetto il salvataggio si rifiuta col numero, e la chat salvata resta quella di prima', async () => {
  await Chats.save('d1', turno('uno', 'A'));
  const troppi = [];
  for (let i = 0; i <= globalThis.SN_DECK_CHAT.MAX_MESSAGES; i += 1) troppi.push({ who: 'user', text: `m${i}` });
  const r = await call(MSG.DECKS_CHAT_SAVE, { deckId: 'd1', messages: troppi });
  assert.deepEqual(r, { ok: false, error: 'too_many', max: globalThis.SN_DECK_CHAT.MAX_MESSAGES });
  assert.equal(disco[KEY].d1.messages.length, 2);
});

test('una risposta in volo si salva come interrotta', async () => {
  await Chats.save('d1', [{ who: 'user', text: 'cerca' }, { who: 'bot', pending: true }]);
  assert.deepEqual((await Chats.get('d1'))[1], { who: 'bot', interrupted: true });
});

test('il canale risponde solo alle pagine di Filo', async () => {
  await Chats.save('d1', turno('uno', 'A'));
  for (const origin of ['https://sito.example/', '', 'file:///x.html']) {
    assert.deepEqual(await call(MSG.DECKS_CHAT_GET, { deckId: 'd1' }, origin), { ok: false, error: 'forbidden' });
    assert.deepEqual(await call(MSG.DECKS_CHAT_SAVE, { deckId: 'd1', messages: [] }, origin), { ok: false, error: 'forbidden' });
    assert.deepEqual(await call(MSG.DECKS_CHAT_CLEAR, { deckId: 'd1' }, origin), { ok: false, error: 'forbidden' });
  }
  assert.equal(disco[KEY].d1.messages.length, 2);
});
