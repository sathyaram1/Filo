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
  for (const fn of ['normCriterion', 'parseSearchKeep', 'planSearchFilter', 'updateSearchCache', 'searchFilterNote', 'searchCapNote', 'searchEmptyNote']) {
    assert.equal(typeof O[fn], 'function', `manca ${fn}`);
  }
});

test('normCriterion: minuscolo, trim e spazi normalizzati (chiavi di cache stabili)', () => {
  assert.equal(O.normCriterion('  Riporta  Creature  dal Cimitero '), 'riporta creature dal cimitero');
  assert.equal(O.normCriterion('Riporta creature dal cimitero'), O.normCriterion('riporta   creature dal cimitero'));
});

test('parseSearchKeep: tiene solo gli id keep davvero giudicati, tollera fence e array nudo', () => {
  const judge = ['a', 'b', 'c'];
  // Oggetto { keep: [...] } dentro un fence.
  const r1 = O.parseSearchKeep('```json\n{"keep":["a","c"]}\n```', judge);
  assert.deepEqual([...r1].sort(), ['a', 'c']);
  // Array nudo di id.
  const r2 = O.parseSearchKeep('["b"]', judge);
  assert.deepEqual([...r2], ['b']);
  // Risposta non-JSON o senza lista keep → null, non «nessuna tiene» (#382: salvata così avvelenava la cache).
  assert.equal(O.parseSearchKeep('boh', judge), null);
  assert.equal(O.parseSearchKeep('{"reply":"Ok."}', judge), null);
  // Lista vuota letta davvero: nessuna tiene.
  assert.equal(O.parseSearchKeep('{"keep":[]}', judge).size, 0);
});

test('parseSearchKeep: i numeri della lista valgono come le carte in quella posizione (#382)', () => {
  const judge = ['uuid-a', 'uuid-b', 'uuid-c'];
  assert.deepEqual([...O.parseSearchKeep('{"keep":[1,3]}', judge)].sort(), ['uuid-a', 'uuid-c']);
  assert.deepEqual([...O.parseSearchKeep('{"keep":["2"]}', judge)], ['uuid-b']);
});

test('parseSearchKeep: una voce che non indica una carta della lista rende illeggibile la risposta, non «nessuna tiene» (#382)', () => {
  const judge = ['uuid-a', 'uuid-b', 'uuid-c'];
  // Coi nomi al posto dei numeri il giudice non ha scartato niente: salvarla come tutte scartate bloccava la ricerca.
  assert.equal(O.parseSearchKeep('{"keep":["Hammer of Purphoros"]}', judge), null);
  assert.equal(O.parseSearchKeep('{"keep":[{"n":2}]}', judge), null);
  // Fuori lista (0, 4, negativi, decimali) o un id inventato: la numerazione del giudice non è quella della lista.
  for (const k of ['[0]', '[4]', '[-1]', '[1.5]', '[1, 4]', '["uuid-a", "uuid-z"]', '["2."]']) {
    assert.equal(O.parseSearchKeep(`{"keep":${k}}`, judge), null, k);
  }
});

test('updateSearchCache con keepPrefix: i giudizi di un giudice con altre istruzioni se ne vanno (#382)', () => {
  const before = { a: { 'vecchio criterio': false, 'fp1|x': true }, b: { 'fp0|y': false } };
  const after = O.updateSearchCache(before, 'fp1|z', { c: true }, { keepPrefix: 'fp1|' });
  assert.deepEqual(after, { a: { 'fp1|x': true }, c: { 'fp1|z': true } });
});

test('updateSearchCache con tetti: escono i giudizi più vecchi, mai quelli appena dati (#382)', () => {
  // Per carta: il criterio rigiudicato torna in fondo, e oltre il tetto esce il più vecchio.
  const perCard = O.updateSearchCache({ a: { k1: true, k2: false, k3: true } }, 'k1', { a: false }, { maxPerCard: 3 });
  assert.deepEqual(Object.keys(perCard.a), ['k2', 'k3', 'k1']);
  const trimmed = O.updateSearchCache(perCard, 'k4', { a: true }, { maxPerCard: 3 });
  assert.deepEqual(trimmed.a, { k3: true, k1: false, k4: true });

  // In tutto: escono le carte giudicate da più tempo, le fresche restano tutte.
  let cache = {};
  for (const [i, id] of ['c1', 'c2', 'c3', 'c4'].entries()) cache = O.updateSearchCache(cache, `k${i}`, { [id]: true }, { maxPairs: 3 });
  assert.deepEqual(Object.keys(cache), ['c2', 'c3', 'c4']);
  const fresh = O.updateSearchCache(cache, 'nuovo', { x: true, y: false, z: true }, { maxPairs: 3 });
  assert.deepEqual(fresh, { x: { nuovo: true }, y: { nuovo: false }, z: { nuovo: true } });
  // Una carta rigiudicata diventa la più giovane e non esce.
  const touched = O.updateSearchCache(cache, 'altro', { c2: false }, { maxPairs: 3 });
  assert.deepEqual(Object.keys(touched), ['c4', 'c2']);
  assert.deepEqual(touched.c2, { k1: true, altro: false });
});

test('searchFilterNote: scartate mai mostrate in silenzio, non controllate sempre dichiarate (#382)', () => {
  assert.equal(O.searchFilterNote({ found: 10, kept: 4, unverified: 0, criterion: 'x' }), '', 'filtro riuscito: niente da dire');
  const none = O.searchFilterNote({ found: 12, kept: 0, unverified: 0, criterion: ' dà haste ad altre creature ' });
  assert.match(none, /12 carte trovate/);
  assert.match(none, /nessuna corrisponde a «dà haste ad altre creature»/);
  assert.match(O.searchFilterNote({ found: 1, kept: 0, unverified: 0, criterion: 'x' }), /^Ho controllato la carta trovata, ma non corrisponde a «x»/);
  const long = O.searchFilterNote({ found: 3, kept: 0, unverified: 0, criterion: 'parola '.repeat(2000) });
  assert.ok(long.length < 400, 'un criterio lunghissimo non riempie la chat');
  assert.match(long, /…»/, 'il taglio si vede');
  const all = O.searchFilterNote({ found: 5, kept: 5, unverified: 5, criterion: 'x', why: 'problema di rete.' });
  assert.match(all, /senza filtro/);
  assert.match(all, /Motivo: problema di rete\./);
  assert.match(O.searchFilterNote({ found: 5, kept: 3, unverified: 1, criterion: 'x' }), /^Una delle carte qui sotto, segnata con \?/);
  assert.match(O.searchFilterNote({ found: 90, kept: 60, unverified: 40, criterion: 'x' }), /^40 delle carte qui sotto, segnate con \?/);
});

test('searchFilterNote: le carte trovate oltre quelle arrivate al giudice si dichiarano col numero (#382)', () => {
  const some = O.searchFilterNote({ found: 1050, kept: 12, unverified: 0, criterion: 'x', total: 12340 });
  assert.match(some, /Scryfall ne ha trovate 12\.340 e ho controllato le prime 1\.050, in ordine di costo/);
  assert.match(some, /aggiungi un vincolo/);
  const none = O.searchFilterNote({ found: 1050, kept: 0, unverified: 0, criterion: 'dà haste', total: 2340 });
  assert.match(none, /le prime 1\.050 delle 2\.340 carte trovate/);
  assert.doesNotMatch(none, /Ho controllato una per una le 1\.050 carte trovate/, 'non dice di averle viste tutte');
  const raw = O.searchFilterNote({ found: 1050, kept: 1050, unverified: 1050, criterion: 'x', total: 2340 });
  assert.match(raw, /qui sotto ci sono le prime 1\.050/, 'senza giudice non dice «ho controllato»');
  assert.equal(O.searchFilterNote({ found: 10, kept: 4, unverified: 0, criterion: 'x', total: 10 }), '');
  assert.equal(O.searchCapNote({ seen: 175, total: 175, judged: false }), '');
  assert.match(O.searchCapNote({ seen: 175, total: 900, judged: false }), /^Scryfall ne ha trovate 900 e qui sotto ci sono le prime 175/);
});

test('searchFilterNote: le pagine perse per un guasto chiedono di riprovare, non un vincolo in più (#382)', () => {
  const some = O.searchFilterNote({ found: 175, kept: 3, unverified: 0, criterion: 'x', total: 525, broken: true });
  assert.match(some, /Scryfall ne ha trovate 525 ma ha smesso di rispondere dopo le prime 175, quindi ho controllato solo quelle\. Riprova/);
  assert.doesNotMatch(some, /vincolo/);
  const none = O.searchFilterNote({ found: 175, kept: 0, unverified: 0, criterion: 'dà haste', total: 525, broken: true });
  assert.match(none, /le prime 175 delle 525 carte trovate/);
  assert.match(none, /smesso di rispondere\. Riprova/);
  assert.doesNotMatch(none, /vincolo/);
  const raw = O.searchCapNote({ seen: 175, total: 525, judged: false, broken: true });
  assert.match(raw, /qui sotto ci sono solo quelle\. Riprova/);
});

test('searchEmptyNote: una ricerca senza risultati lo dice, come quella che il giudice scarta tutta (#382)', () => {
  assert.match(O.searchEmptyNote(), /^Nessun risultato su Scryfall per questa ricerca\. Prova a chiederlo con altre parole\.$/);
  assert.match(O.searchEmptyNote({ identity: true }), /fra le carte nei colori del commander/);
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
