// #1302 — chat dei mazzi: la query corretta dopo un rifiuto di Scryfall fermata dal tetto. La bolla dice che la risposta
// ha raggiunto la lunghezza massima e porta il tasto per le Preferenze, non «riformula»: l'handler vero, il resto finto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
for (const m of ['constants', 'contenutoEsterno', 'messages', 'chatErrors', 'decks', 'scryfallQuery', 'deckChat', 'deckOpinions']) {
  require(`../../src/shared/${m}.js`);
}
require('../../src/main/services/deckChats.js');
const { MSG } = globalThis.SN_MSG;
const Decks = globalThis.SN_DECKS;
const CE = globalThis.SN_CHAT_ERRORS;

globalThis.SN_SCRYFALL = {
  named: async () => null,
  cards: async () => ({}),
  search: async () => { throw Object.assign(new Error('Scryfall 400'), { status: 400, details: 'unknown keyword' }); },
  remember: async () => {},
  isTimeout: () => false,
};
globalThis.SN_DECK_OPINIONS_SVC = { filterSearch: async ({ cardIds }) => ({ keepIds: cardIds, unverifiedIds: [], judgedCount: 0, error: null }) };
const db = new Map();
globalThis.SN_DECK_STORE = { get: async (id) => db.get(id) || null, put: async (d) => { db.set(d.id, d); return d; }, list: async () => [...db.values()] };

let chiamate = 0;
const handleAIRequest = async (args) => {
  chiamate += 1;
  if (chiamate === 1) return { text: JSON.stringify({ reply: 'Cerco.', query: 'o:hast3 t:creatur' }), finishReason: 'stop' };
  assert.equal(args.intera, true);
  throw CE.erroreTagliata('length');
};
const handlers = new Map();
require('../../src/main/services/handlers/scryfall.js')((t, fn) => handlers.set(t, fn), {
  MSG, handleAIRequest, getEffectiveSettings: async () => ({}), buildAttemptChain: () => [], modelForAction: () => '',
});

test('la query corretta fermata dal tetto: la bolla dice la lunghezza massima, non di riformulare', async () => {
  const d = Decks.newDeck({ nome: 'Prova' });
  db.set(d.id, d);
  const wc = Object.assign(new EventEmitter(), { id: 1, send() {}, isDestroyed: () => false });
  const r = await handlers.get(MSG.DECKS_CHAT)({ deckId: d.id, text: 'creature con rapidità', reasoningReqId: 'q1' }, { wc }, 'filo://decks/decks.html');
  assert.equal(chiamate, 2);
  assert.equal(r.ok, true);
  assert.match(r.reply, /lunghezza massima/);
  assert.match(r.reply, /Preferenze/);
  assert.doesNotMatch(r.reply, /riformulare/);
  assert.equal(r.rimedio?.code, 'RISPOSTA_TAGLIATA');
  assert.equal(CE.rimedioPagina(r.rimedio)?.dove, 'preferenze');
});
