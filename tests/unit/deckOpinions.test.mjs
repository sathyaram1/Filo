// Unit test per src/shared/deckOpinions.js — pareri LLM e auto-tag del deck
// builder (DECK-BUILDER-SPEC.md §6-§7). Invarianti sotto test:
// - un parere è stantio quando `deck.versione` supera la versione su cui è
//   stato calcolato (§6.2), e MAI prima;
// - il parsing delle risposte batch è tollerante (fence, testo attorno) e
//   scarta id/pareri vuoti;
// - i tag context-free sono cacheabili cross-mazzo, i contestuali mai (§7);
// - il piano di tagging salta l'LLM per le carte interamente coperte dalla
//   cache e la cache si aggiorna SOLO con le carte davvero giudicate;
// - applicare la membership tocca il mazzo UNA volta (versione +1) e solo se
//   qualcosa cambia davvero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'decks.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'deckOpinions.js'));

const O = globalThis.SN_DECK_OPINIONS;
const D = globalThis.SN_DECKS;

test('deckOpinions si registra su globalThis con la sua API', () => {
  assert.ok(O);
  for (const fn of ['isStale', 'isContextFreeTag', 'parseOpinionBatch', 'parseTagBatch', 'planTagJudgments', 'updateTagCache', 'applyTagMembership']) {
    assert.equal(typeof O[fn], 'function', `manca ${fn}`);
  }
});

// ── Staleness per versione (§6.2) ───────────────────────────────────────────

test('isStale: il parere resta fresco finché il mazzo non cambia, stantio dopo', () => {
  const entry = { text: 'ok', versione: 3 };
  assert.equal(O.isStale(entry, { versione: 3 }), false, 'stessa versione = fresco');
  assert.equal(O.isStale(entry, { versione: 4 }), true, 'versione avanzata = stantio');
  assert.equal(O.isStale(entry, { versione: 2 }), false, 'versione precedente non rende stantio');
  assert.equal(O.isStale(null, { versione: 9 }), false, 'entry assente non è "stantia"');
});

test('isStale segue il ciclo di vita reale del mazzo (touch di SN_DECKS)', () => {
  let deck = D.newDeck({ nome: 'Test' });
  const { deck: d2 } = D.addCard(deck, 'carta-1');
  deck = d2;
  const entry = { text: 'parere', versione: deck.versione };
  assert.equal(O.isStale(entry, deck), false, 'appena calcolato: fresco');
  // Ogni edit (aggiunta di un'altra carta) invalida: il parere diventa stantio.
  const { deck: d3 } = D.addCard(deck, 'carta-2');
  assert.equal(O.isStale(entry, d3), true, 'dopo un edit: stantio');
  // Una NON-modifica (carta già presente) non deve invalidare nulla.
  const { deck: d4, added } = D.addCard(d3, 'carta-2');
  assert.equal(added, false);
  const fresh = { text: 'parere', versione: d3.versione };
  assert.equal(O.isStale(fresh, d4), false, 'non-modifica: resta fresco');
});

// ── Parsing risposte batch ──────────────────────────────────────────────────

test('parseOpinionBatch: oggetto con sintesi + pareri', () => {
  const r = O.parseOpinionBatch(JSON.stringify({
    sintesi: 'Mazzo solido.',
    pareri: [
      { id: 'a1', parere: 'Ottima col commander.' },
      { id: 'b2', parere: 'Ridondante.' },
      { id: '', parere: 'senza id' },
      { id: 'c3', parere: '' },
    ],
  }));
  assert.equal(r.sintesi, 'Mazzo solido.');
  assert.deepEqual(r.opinions, { a1: 'Ottima col commander.', b2: 'Ridondante.' });
});

test('parseOpinionBatch: array nudo, fence markdown e testo attorno', () => {
  const r = O.parseOpinionBatch('Ecco:\n```json\n[{"id":"x","parere":"Va bene."}]\n```\ngrazie');
  assert.deepEqual(r.opinions, { x: 'Va bene.' });
  assert.equal(r.sintesi, '');
  assert.deepEqual(O.parseOpinionBatch('niente json').opinions, {});
});

test('parseTagBatch: mappa id → tag normalizzati; lista vuota è informazione', () => {
  const r = O.parseTagBatch(JSON.stringify({ a1: ['Ramp', ' DRAW '], b2: [] }));
  assert.deepEqual(r, { a1: ['ramp', 'draw'], b2: [] });
  // Forma alternativa ad array di { id, tags }.
  const r2 = O.parseTagBatch('```json\n[{"id":"a1","tags":["removal"]}]\n```');
  assert.deepEqual(r2, { a1: ['removal'] });
});

// ── Tag context-free vs contestuali (§7) ────────────────────────────────────

test('isContextFreeTag: "ramp"/"draw"/"payoff self-mill" sì, sinergie col mazzo no', () => {
  for (const t of ['ramp', 'draw', 'removal', 'payoff self-mill', 'terre']) {
    assert.equal(O.isContextFreeTag(t), true, `${t} deve essere context-free`);
  }
  for (const t of ['sinergia col commander', 'combo', 'protegge il mio commander', 'chiave del mazzo']) {
    assert.equal(O.isContextFreeTag(t), false, `${t} deve essere contestuale`);
  }
});

test('planTagJudgments: le carte interamente coperte dalla cache saltano l\'LLM', () => {
  const tagCache = {
    a1: { ramp: true, draw: false },
    b2: { ramp: false }, // manca "draw" → va giudicata
  };
  const plan = O.planTagJudgments({ cardIds: ['a1', 'b2', 'c3'], tags: ['ramp', 'draw'], tagCache });
  assert.deepEqual(plan.judgeIds, ['b2', 'c3']);
  assert.deepEqual(plan.membershipFromCache, { a1: ['ramp'] });
});

test('planTagJudgments: un tag contestuale forza il giudizio di TUTTE le carte', () => {
  const tagCache = { a1: { ramp: true } };
  const plan = O.planTagJudgments({
    cardIds: ['a1'], tags: ['ramp', 'sinergia col commander'], tagCache,
  });
  assert.deepEqual(plan.judgeIds, ['a1'], 'la cache non basta: il tag contestuale non è cacheabile');
});

test('updateTagCache: scrive solo tag context-free e solo carte giudicate', () => {
  const cache = { old: { ramp: true } };
  const next = O.updateTagCache(cache, ['ramp', 'sinergia col commander'], {
    a1: ['ramp', 'sinergia col commander'],
    b2: [],
  });
  // La carta giudicata ha true/false per il tag context-free…
  assert.equal(next.a1.ramp, true);
  assert.equal(next.b2.ramp, false, 'lista vuota = giudicata: nessun tag (cacheabile come false)');
  // …ma MAI il tag contestuale.
  assert.equal('sinergia col commander' in next.a1, false);
  // Le entry preesistenti restano; l'input non è mutato.
  assert.equal(next.old.ramp, true);
  assert.deepEqual(cache, { old: { ramp: true } });
});

// ── Applicazione della membership al mazzo ──────────────────────────────────

function deckWith(cards) {
  let deck = D.newDeck({ nome: 'T' });
  for (const [id, tags] of cards) {
    const r = D.addCard(deck, id, { tags });
    deck = r.deck;
  }
  return deck;
}

test('applyTagMembership: aggiunge i tag pertinenti, una sola versione in più', () => {
  const deck = deckWith([['a1', []], ['b2', []]]);
  const v0 = deck.versione;
  const r = O.applyTagMembership(deck, ['ramp', 'draw'], { a1: ['ramp'], b2: ['ramp', 'draw'] });
  assert.equal(r.changed, true);
  assert.equal(r.taggedCount, 2);
  assert.equal(r.deck.versione, v0 + 1, 'UN solo touch per tutto il batch');
  assert.deepEqual(r.deck.carte.find((c) => c.scryfall_id === 'a1').tags, ['ramp']);
  assert.deepEqual(r.deck.carte.find((c) => c.scryfall_id === 'b2').tags, ['ramp', 'draw']);
});

test('applyTagMembership: riallinea i tag richiesti, preserva quelli manuali', () => {
  const deck = deckWith([['a1', ['manuale', 'ramp']]]);
  // Rigiudicata: NON è più ramp. Il tag manuale non richiesto resta.
  const r = O.applyTagMembership(deck, ['ramp'], { a1: [] });
  assert.equal(r.changed, true);
  assert.deepEqual(r.deck.carte[0].tags, ['manuale']);
});

test('applyTagMembership: carte non giudicate e giudizi identici non toccano il mazzo', () => {
  const deck = deckWith([['a1', ['ramp']], ['b2', ['x']]]);
  const v0 = deck.versione;
  // a1 confermata ramp (nessun cambiamento), b2 NON giudicata (assente).
  const r = O.applyTagMembership(deck, ['ramp'], { a1: ['ramp'] });
  assert.equal(r.changed, false, 'nessun cambiamento reale → nessun touch');
  assert.equal(r.deck.versione, v0, 'la versione NON avanza (i pareri non si invalidano a vuoto)');
  assert.deepEqual(r.deck.carte[1].tags, ['x'], 'carta non giudicata intatta');
});

// ── Filtro semantico dei risultati di ricerca (§4.1) ────────────────────────
// La query Scryfall è larga (sinonimi); un LLM economico decide carta-per-carta
// se rispetta il criterio, con cache (carta, criterio) permanente cross-ricerca.

test('search filter: API registrata su globalThis', () => {
  for (const fn of ['normCriterion', 'parseSearchKeep', 'planSearchFilter', 'updateSearchCache']) {
    assert.equal(typeof O[fn], 'function', `manca ${fn}`);
  }
});

test('normCriterion: minuscolo, trim e spazi normalizzati (chiavi di cache stabili)', () => {
  assert.equal(O.normCriterion('  Riporta  Creature  dal Cimitero '), 'riporta creature dal cimitero');
  assert.equal(O.normCriterion('Riporta creature dal cimitero'), O.normCriterion('riporta   creature dal cimitero'));
});

test('parseSearchKeep: tiene solo gli id keep davvero giudicati, tollera fence e array nudo', () => {
  const judge = ['a', 'b', 'c'];
  // Oggetto { keep: [...] } dentro un fence, con un id inventato ('z') scartato.
  const r1 = O.parseSearchKeep('```json\n{"keep":["a","c","z"]}\n```', judge);
  assert.deepEqual([...r1].sort(), ['a', 'c']);
  // Array nudo di id.
  const r2 = O.parseSearchKeep('["b"]', judge);
  assert.deepEqual([...r2], ['b']);
  // Risposta non-JSON → nessun keep (non si inventa nulla).
  assert.equal(O.parseSearchKeep('boh', judge).size, 0);
});

test('planSearchFilter: separa cache-hit da giudicare, preserva ordine, keepFromCache solo i true', () => {
  const cache = {
    a: { 'x y': true },
    b: { 'x y': false },
    // c non in cache → da giudicare
  };
  const plan = O.planSearchFilter({ cardIds: ['a', 'b', 'c'], criterion: 'X Y', searchCache: cache });
  assert.deepEqual(plan.judgeIds, ['c'], 'solo c va giudicata (a,b già decise)');
  assert.deepEqual(plan.keepFromCache, ['a'], 'a passa da cache (true); b scartata (false)');
});

test('updateSearchCache: scrive i giudizi freschi senza mutare l\'input, chiave normalizzata', () => {
  const before = { a: { 'vecchio': true } };
  const after = O.updateSearchCache(before, '  Riporta Creature ', { a: true, b: false });
  // Input non mutato.
  assert.deepEqual(before, { a: { 'vecchio': true } });
  // Nuovo giudizio sotto la chiave normalizzata, vecchio preservato.
  assert.equal(after.a['riporta creature'], true);
  assert.equal(after.a['vecchio'], true);
  assert.equal(after.b['riporta creature'], false);
});

test('planSearchFilter + updateSearchCache: seconda ricerca uguale non rigiudica nulla', () => {
  const ids = ['a', 'b', 'c'];
  // Prima ricerca: tutto da giudicare, il modello tiene a e c.
  const plan1 = O.planSearchFilter({ cardIds: ids, criterion: 'ramp veloce', searchCache: {} });
  assert.deepEqual(plan1.judgeIds, ids);
  const judged = { a: true, b: false, c: true };
  const cache = O.updateSearchCache({}, 'ramp veloce', judged);
  // Seconda ricerca identica: zero chiamate LLM, keep ricostruito da cache.
  const plan2 = O.planSearchFilter({ cardIds: ids, criterion: 'RAMP  veloce', searchCache: cache });
  assert.deepEqual(plan2.judgeIds, [], 'niente da rigiudicare');
  assert.deepEqual(plan2.keepFromCache, ['a', 'c']);
});
