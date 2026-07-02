// Unit test per src/shared/decks.js — il modello dati dei mazzi Commander
// (DECK-BUILDER-SPEC.md §13.1). Invariante centrale sotto test: `versione`
// incrementa a OGNI modifica reale del mazzo (è la chiave di invalidazione dei
// pareri LLM), e NON incrementa per le non-modifiche (rinomina uguale, carta
// già presente).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'decks.js'));

const D = globalThis.SN_DECKS;

test('decks si registra su globalThis con la sua API', () => {
  assert.ok(D);
  for (const fn of ['newDeck', 'sanitizeDeck', 'addCard', 'removeCard', 'renameDeck', 'setCommander', 'duplicateDeck', 'deckCount', 'sortForLibrary']) {
    assert.equal(typeof D[fn], 'function', `manca ${fn}`);
  }
});

test('newDeck: mazzo vuoto conforme allo schema §13.1', () => {
  const d = D.newDeck({ nome: '  Mono Blu  ' });
  assert.ok(d.id);
  assert.equal(d.nome, 'Mono Blu');
  assert.equal(d.commander, '');
  assert.deepEqual(d.carte, []);
  assert.equal(d.raggruppamento, 'tipo');
  assert.equal(d.budget, null);
  assert.equal(d.versione, 1);
  assert.ok(d.created_at && d.updated_at);
});

test('newDeck senza nome usa il default', () => {
  assert.equal(D.newDeck().nome, 'Nuovo mazzo');
});

test('addCard aggiunge e incrementa la versione', () => {
  const d = D.newDeck({ nome: 'X' });
  const { deck, added } = D.addCard(d, 'scry-1');
  assert.equal(added, true);
  assert.equal(deck.carte.length, 1);
  assert.equal(deck.carte[0].qty, 1);
  assert.equal(deck.versione, d.versione + 1);
});

test('addCard su carta già presente NON duplica e NON tocca la versione', () => {
  const { deck: d1 } = D.addCard(D.newDeck(), 'scry-1');
  const { deck: d2, added } = D.addCard(d1, 'scry-1');
  assert.equal(added, false);
  assert.equal(d2.carte.length, 1);
  assert.equal(d2.versione, d1.versione);
});

test('removeCard rimuove e incrementa; su carta assente non incrementa', () => {
  const { deck: d1 } = D.addCard(D.newDeck(), 'scry-1');
  const { deck: d2, removed } = D.removeCard(d1, 'scry-1');
  assert.equal(removed, true);
  assert.equal(d2.carte.length, 0);
  assert.equal(d2.versione, d1.versione + 1);
  const { deck: d3, removed: r3 } = D.removeCard(d2, 'scry-ghost');
  assert.equal(r3, false);
  assert.equal(d3.versione, d2.versione);
});

test('renameDeck: nome nuovo incrementa, nome uguale/vuoto no', () => {
  const d = D.newDeck({ nome: 'A' });
  const r1 = D.renameDeck(d, 'B');
  assert.equal(r1.nome, 'B');
  assert.equal(r1.versione, d.versione + 1);
  assert.equal(D.renameDeck(d, 'A'), d);
  assert.equal(D.renameDeck(d, '   '), d);
});

test('setCommander salva id + meta e incrementa la versione', () => {
  const d = D.newDeck();
  const meta = { name: 'Niv-Mizzet', colors: ['U', 'R'], artCrop: 'https://x/y.jpg' };
  const r = D.setCommander(d, 'scry-niv', meta);
  assert.equal(r.commander, 'scry-niv');
  assert.deepEqual(r.commanderMeta.colors, ['U', 'R']);
  assert.equal(r.versione, d.versione + 1);
});

test('deckCount somma le qty (basics con qty > 1)', () => {
  let { deck } = D.addCard(D.newDeck(), 'scry-1');
  ({ deck } = D.addCard(deck, 'scry-island', { qty: 30 }));
  assert.equal(D.deckCount(deck), 31);
});

test('duplicateDeck: nuovo id, nome (copia), versione ripartita, carte copiate in profondità', () => {
  let { deck } = D.addCard(D.newDeck({ nome: 'Orig' }), 'scry-1', { tags: ['ramp'] });
  deck = D.touch(deck); // versione > 1
  const copy = D.duplicateDeck(deck);
  assert.notEqual(copy.id, deck.id);
  assert.equal(copy.nome, 'Orig (copia)');
  assert.equal(copy.versione, 1);
  assert.deepEqual(copy.carte[0].tags, ['ramp']);
  copy.carte[0].tags.push('draw');
  assert.deepEqual(deck.carte[0].tags, ['ramp'], 'i tags della copia non devono condividere l\'array');
});

test('sanitizeDeck ripara campi mancanti o sporchi', () => {
  const raw = {
    id: 'x', nome: '', carte: [{ scryfall_id: 'a', qty: '0' }, { qty: 2 }, null],
    raggruppamento: 'boh', budget: '40', versione: '3',
  };
  const d = D.sanitizeDeck(raw);
  assert.equal(d.nome, 'Mazzo senza nome');
  assert.equal(d.carte.length, 1, 'le carte senza scryfall_id vanno scartate');
  assert.equal(d.carte[0].qty, 1, 'qty minima 1');
  assert.equal(d.raggruppamento, 'tipo');
  assert.equal(d.budget, 40);
  assert.equal(d.versione, 3);
  assert.equal(D.sanitizeDeck({ nome: 'senza id' }), null);
});

test('sortForLibrary: ultima modifica in cima', () => {
  const a = { ...D.newDeck({ nome: 'vecchio' }), updated_at: '2026-01-01T00:00:00.000Z' };
  const b = { ...D.newDeck({ nome: 'recente' }), updated_at: '2026-06-01T00:00:00.000Z' };
  const sorted = D.sortForLibrary([a, b]);
  assert.equal(sorted[0].nome, 'recente');
});
