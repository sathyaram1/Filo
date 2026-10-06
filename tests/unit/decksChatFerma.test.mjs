// «Ferma» sulla chat dei mazzi, lato main (#792): l'handler vero di src/main/services/handlers/scryfall.js con
// modello, Scryfall e magazzino finti. Fermato il turno, la chiamata al modello è annullata davvero e il mazzo non
// porta nessuna modifica a metà; il canale per fermare risponde solo a Filo e alla scheda che ha avviato il turno.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

require(join(ROOT, 'src', 'shared', 'constants.js'));
require(join(ROOT, 'src', 'shared', 'messages.js'));
require(join(ROOT, 'src', 'shared', 'decks.js'));
require(join(ROOT, 'src', 'shared', 'scryfallQuery.js'));
require(join(ROOT, 'src', 'shared', 'deckChat.js'));
require(join(ROOT, 'src', 'shared', 'deckOpinions.js'));
require(join(ROOT, 'src', 'main', 'services', 'deckChats.js'));

const { MSG } = globalThis.SN_MSG;
const Decks = globalThis.SN_DECKS;

const NIV = { id: 'niv-1', name: 'Niv-Mizzet, Parun', colorIdentity: ['U', 'R'], artCrop: '' };
const BOLT = { id: 'bolt-1', name: 'Lightning Bolt', colorIdentity: ['R'], cmc: 1 };

// Scryfall finto: `searchHangs` tiene la ricerca appesa finché chi aspetta non la ferma; `searchError` la fa cadere.
let searchHangs = false;
let searchError = null;
globalThis.SN_SCRYFALL = {
  named: async (name) => (/niv/i.test(name) ? NIV : null),
  cards: async () => ({}),
  search: async (_q, { signal } = {}) => {
    if (searchError) throw searchError;
    if (searchHangs) {
      await new Promise((_, reject) => {
        if (!signal) return;
        signal.addEventListener('abort', () => reject(Object.assign(new Error('fermata'), { code: 'ABORT_ERR' })), { once: true });
      });
    }
    return { cards: [BOLT], hasMore: false, total: 1, query: 'o:haste', broken: false };
  },
  remember: async () => {},
  isTimeout: (e) => !!(e && e.code === 'SCRYFALL_TIMEOUT'),
};
globalThis.SN_DECK_OPINIONS_SVC = {
  filterSearch: async ({ cardIds }) => ({ keepIds: cardIds, unverifiedIds: [], judgedCount: 0, error: null }),
};

const db = new Map();
let puts = 0;
globalThis.SN_DECK_STORE = {
  get: async (id) => db.get(id) || null,
  put: async (deck) => { puts += 1; db.set(deck.id, deck); return deck; },
  list: async () => [...db.values()],
};

// Modello finto: `modelHangs` non risponde mai finché la chiamata non viene annullata.
let aiReply = '{}';
let modelHangs = false;
let cancello = null;
const aiCalls = [];
const handleAIRequest = async (args) => {
  aiCalls.push(args);
  if (cancello) await cancello;
  if (modelHangs) {
    await new Promise((_, reject) => {
      const s = args.signal;
      if (!s) return;
      if (s.aborted) { reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
      s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    });
  }
  return { text: aiReply };
};

const handlers = new Map();
require(join(ROOT, 'src', 'main', 'services', 'handlers', 'scryfall.js'))(
  (type, fn) => handlers.set(type, fn),
  { MSG, handleAIRequest, getEffectiveSettings: async () => ({}), buildAttemptChain: () => [], modelForAction: () => '' },
);

const FILO = 'filo://decks/decks.html';
const scheda = (id) => Object.assign(new EventEmitter(), { id, send() {}, isDestroyed: () => false });
const chat = (msg, wc) => handlers.get(MSG.DECKS_CHAT)(msg, { wc }, FILO);
const ferma = (reqId, wc, origin = FILO) => handlers.get(MSG.DECKS_CHAT_STOP)({ reqId }, { wc }, origin);
const finché = async (cond) => { for (let i = 0; i < 200 && !cond(); i += 1) await new Promise((r) => setTimeout(r, 5)); };

function seedDeck() {
  const d = Decks.newDeck({ nome: 'Prova' });
  db.set(d.id, d);
  return d;
}

beforeEach(() => {
  db.clear(); puts = 0; aiCalls.length = 0;
  aiReply = '{}'; modelHangs = false; searchHangs = false; searchError = null; cancello = null;
});

test('Ferma annulla davvero la chiamata al modello e il turno torna «fermato»', async () => {
  const deck = seedDeck();
  const wc = scheda(1);
  modelHangs = true;
  const turno = chat({ deckId: deck.id, text: 'draghi rossi', reasoningReqId: 'r1' }, wc);
  await finché(() => aiCalls.length === 1);
  assert.ok(aiCalls[0].signal, 'la chiamata al modello deve portare un segnale di annullamento');
  assert.deepEqual(await ferma('r1', wc), { ok: true, fermato: true });
  assert.equal(aiCalls[0].signal.aborted, true);
  const r = await turno;
  assert.equal(r.ok, false);
  assert.equal(r.stopped, true);
});

test('fermato durante la ricerca: commander e budget chiesti nello stesso turno non toccano il mazzo', async () => {
  const deck = seedDeck();
  const wc = scheda(1);
  aiReply = JSON.stringify({ reply: 'Ecco.', commander: 'Niv-Mizzet, Parun', budget: 40, query: 'o:haste' });
  searchHangs = true;
  const turno = chat({ deckId: deck.id, text: 'niv con budget 40 e carte haste', reasoningReqId: 'r2' }, wc);
  await finché(() => aiCalls.length === 1);
  await new Promise((r) => setTimeout(r, 20));
  await ferma('r2', wc);
  const r = await turno;
  assert.equal(r.stopped, true);
  assert.equal(puts, 0, 'nessuna scrittura del mazzo');
  assert.ok(!db.get(deck.id).commander);
  assert.equal(db.get(deck.id).budget, null);
});

test('a risposta arrivata commander e budget si scrivono insieme, sul mazzo riletto', async () => {
  const deck = seedDeck();
  const wc = scheda(1);
  aiReply = JSON.stringify({ reply: 'Ecco.', commander: 'Niv-Mizzet, Parun', budget: 40, query: 'o:haste' });
  let libera;
  cancello = new Promise((r) => { libera = r; });
  const turno = chat({ deckId: deck.id, text: 'niv con budget 40', reasoningReqId: 'r3' }, wc);
  await finché(() => aiCalls.length === 1);
  // Mentre il modello pensa l'utente rinomina il mazzo da un'altra strada: la scrittura finale non lo perde.
  db.set(deck.id, { ...db.get(deck.id), nome: 'Rinominato' });
  libera();
  const r = await turno;
  assert.equal(r.ok, true);
  assert.equal(puts, 1, 'una scrittura sola, alla fine');
  const saved = db.get(deck.id);
  assert.equal(saved.commander, 'niv-1');
  assert.equal(saved.budget, 40);
  assert.equal(saved.nome, 'Rinominato');
  assert.equal(r.deck && r.deck.commander, 'niv-1');
});

test('il canale per fermare risponde solo a Filo e solo alla scheda che ha avviato il turno', async () => {
  const deck = seedDeck();
  const mia = scheda(1);
  const altra = scheda(2);
  modelHangs = true;
  const turno = chat({ deckId: deck.id, text: 'ciao', reasoningReqId: 'r4' }, mia);
  await finché(() => aiCalls.length === 1);
  const daSito = await ferma('r4', altra, 'https://evil.example/pagina');
  assert.equal(daSito.ok, false);
  assert.equal(daSito.code, 'forbidden');
  const daAltraScheda = await ferma('r4', altra);
  assert.equal(daAltraScheda.ok, false);
  assert.equal(aiCalls[0].signal.aborted, false);
  await ferma('r4', mia);
  assert.equal((await turno).stopped, true);
});

test('un Ferma arrivato prima che il turno parta: il modello non viene chiamato', async () => {
  const deck = seedDeck();
  const wc = scheda(1);
  await ferma('r5', wc);
  const r = await chat({ deckId: deck.id, text: 'ciao', reasoningReqId: 'r5' }, wc);
  assert.equal(r.stopped, true);
  assert.equal(aiCalls.length, 0);
});

test('la pagina che aspetta se ne va (ricaricata o chiusa): la chiamata al modello si annulla', async () => {
  const deck = seedDeck();
  const wc = scheda(1);
  modelHangs = true;
  const turno = chat({ deckId: deck.id, text: 'ciao', reasoningReqId: 'r6' }, wc);
  await finché(() => aiCalls.length === 1);
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(aiCalls[0].signal.aborted, true);
  assert.equal((await turno).stopped, true);
  // Un cambio di hash è la stessa pagina che aspetta ancora.
  const wc2 = scheda(2);
  modelHangs = false;
  aiReply = JSON.stringify({ reply: 'ok' });
  const t2 = chat({ deckId: deck.id, text: 'ciao', reasoningReqId: 'r7' }, wc2);
  wc2.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  assert.equal((await t2).ok, true);
});

test('Scryfall che non risponde: la chat lo dice in una frase, col tasto Riprova, senza codici', async () => {
  const deck = seedDeck();
  aiReply = JSON.stringify({ reply: 'Cerco.', query: 'o:haste' });
  searchError = Object.assign(new Error('Scryfall non ha risposto entro 30000 ms'), {
    code: 'SCRYFALL_TIMEOUT', userText: 'Scryfall, l\'archivio delle carte, non ha risposto entro 30 secondi',
  });
  const r = await chat({ deckId: deck.id, text: 'carte haste', reasoningReqId: 'r8' }, scheda(1));
  assert.equal(r.ok, true);
  assert.equal(r.retryable, true);
  assert.match(r.reply, /La ricerca non è arrivata: Scryfall, l'archivio delle carte, non ha risposto entro 30 secondi\. Riprova tra poco\./);
  assert.doesNotMatch(r.reply, /30000|ms\b|SCRYFALL_TIMEOUT|non è stata accettata/);
});
