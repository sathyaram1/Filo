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
  for (const fn of ['newDeck', 'sanitizeDeck', 'addCard', 'removeCard', 'importCards', 'renameDeck', 'setCommander', 'duplicateDeck', 'deckCount', 'sortForLibrary', 'setGroupOverride', 'addTagToCard', 'replaceCardTags']) {
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

// ── importCards (§11): merge bulk usato dall'import testuale/chat ───────────

test('importCards: carte nuove si aggiungono con tags vuoti', () => {
  const d = D.newDeck();
  const { deck, addedCount, updatedCount } = D.importCards(d, [
    { scryfall_id: 'scry-1', qty: 1 },
    { scryfall_id: 'scry-2', qty: 10 },
  ]);
  assert.equal(addedCount, 2);
  assert.equal(updatedCount, 0);
  assert.equal(deck.carte.length, 2);
  assert.deepEqual(deck.carte.find((c) => c.scryfall_id === 'scry-2'), { scryfall_id: 'scry-2', qty: 10, tags: [] });
  assert.equal(deck.versione, d.versione + 1);
});

test('importCards: carte già presenti aggiornano SOLO la qty, i tag restano', () => {
  const { deck: d1 } = D.addCard(D.newDeck(), 'scry-1', { qty: 1, tags: ['ramp'] });
  const { deck: d2, addedCount, updatedCount } = D.importCards(d1, [{ scryfall_id: 'scry-1', qty: 5 }]);
  assert.equal(addedCount, 0);
  assert.equal(updatedCount, 1);
  const entry = d2.carte.find((c) => c.scryfall_id === 'scry-1');
  assert.equal(entry.qty, 5);
  assert.deepEqual(entry.tags, ['ramp']);
  assert.equal(d2.versione, d1.versione + 1);
});

test('importCards: nessuna modifica reale (stessa qty, id vuoti) NON tocca la versione', () => {
  const { deck: d1 } = D.addCard(D.newDeck(), 'scry-1', { qty: 3 });
  const { deck: d2, addedCount, updatedCount } = D.importCards(d1, [{ scryfall_id: 'scry-1', qty: 3 }, { scryfall_id: '' }]);
  assert.equal(addedCount, 0);
  assert.equal(updatedCount, 0);
  assert.equal(d2, d1);
  assert.equal(d2.versione, d1.versione);
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

test('setCommander con id vuoto RIMUOVE il commander (feedback #302)', () => {
  const d = D.setCommander(D.newDeck(), 'scry-niv', { name: 'Niv-Mizzet', colors: ['U', 'R'] });
  assert.equal(d.commander, 'scry-niv', 'precondizione: commander impostato');
  const r = D.setCommander(d, '', null);
  assert.equal(r.commander, '', 'torna a nessun commander');
  assert.equal(r.commanderMeta, null, 'la cache di presentazione è azzerata');
  assert.equal(r.versione, d.versione + 1, 'la versione avanza (edit reale)');
});

// ── Auto-nome dal commander (feedback #345) ────────────────────────────────
test('newDeck: nomeAuto è true senza nome, false con nome scelto', () => {
  assert.equal(D.newDeck().nomeAuto, true);
  assert.equal(D.newDeck({ nome: 'Mono Blu' }).nomeAuto, false);
});

test('setCommander su mazzo con nome automatico lo rinomina col commander', () => {
  const d = D.newDeck(); // nome segnaposto, nomeAuto:true
  const r = D.setCommander(d, 'scry-niv', { name: 'Niv-Mizzet, Parun', colors: ['U', 'R'] });
  assert.equal(r.nome, 'Niv-Mizzet, Parun');
  assert.equal(r.nomeAuto, true, 'resta auto: deve seguire un cambio di commander');
});

test('setCommander NON tocca un nome scelto dall\'utente', () => {
  const d = D.renameDeck(D.newDeck(), 'Il mio mazzone'); // nomeAuto:false
  const r = D.setCommander(d, 'scry-niv', { name: 'Niv-Mizzet, Parun', colors: ['U', 'R'] });
  assert.equal(r.nome, 'Il mio mazzone');
  assert.equal(r.nomeAuto, false);
});

test('cambiare commander su mazzo auto-nominato segue il nuovo commander', () => {
  let d = D.setCommander(D.newDeck(), 'scry-a', { name: 'Atraxa', colors: ['W', 'U', 'B', 'G'] });
  assert.equal(d.nome, 'Atraxa');
  d = D.setCommander(d, 'scry-b', { name: 'Krenko', colors: ['R'] });
  assert.equal(d.nome, 'Krenko');
});

test('renameDeck marca il nome come scelto dall\'utente (nomeAuto:false)', () => {
  const r = D.renameDeck(D.newDeck(), 'Custom');
  assert.equal(r.nome, 'Custom');
  assert.equal(r.nomeAuto, false);
});

test('sanitizeDeck deduce nomeAuto dai mazzi vecchi senza il flag', () => {
  assert.equal(D.sanitizeDeck({ id: 'x', nome: 'Nuovo mazzo' }).nomeAuto, true);
  assert.equal(D.sanitizeDeck({ id: 'x', nome: 'Il mio mazzo' }).nomeAuto, false);
  assert.equal(D.sanitizeDeck({ id: 'x', nome: 'Qualsiasi', nomeAuto: true }).nomeAuto, true);
});

test('duplicateDeck: la copia ha un nome deliberato (nomeAuto:false)', () => {
  const d = D.setCommander(D.newDeck(), 'scry-a', { name: 'Atraxa', colors: ['G'] });
  const copy = D.duplicateDeck(d);
  assert.equal(copy.nome, 'Atraxa (copia)');
  assert.equal(copy.nomeAuto, false);
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

// ─── Task 4: raggruppamento della colonna mazzo (§8.1) ────────────────────────

// Carte finte minimali per i test di raggruppamento/legalità.
const CARDS = {
  'c-bolt':   { id: 'c-bolt', name: 'Lightning Bolt', typeLine: 'Instant', cmc: 1, colors: ['R'], colorIdentity: ['R'], legalCommander: true },
  'c-dragon': { id: 'c-dragon', name: 'Shivan Dragon', typeLine: 'Creature — Dragon', cmc: 6, colors: ['R'], colorIdentity: ['R'], legalCommander: true },
  'c-goblin': { id: 'c-goblin', name: 'Goblin Guide', typeLine: 'Creature — Goblin Scout', cmc: 1, colors: ['R'], colorIdentity: ['R'], legalCommander: true },
  'c-island': { id: 'c-island', name: 'Island', typeLine: 'Basic Land — Island', cmc: 0, colors: [], colorIdentity: ['U'], legalCommander: true },
  'c-sol':    { id: 'c-sol', name: 'Sol Ring', typeLine: 'Artifact', cmc: 1, colors: [], colorIdentity: [], legalCommander: true },
  'c-lutri':  { id: 'c-lutri', name: 'Lutri, the Spellchaser', typeLine: 'Legendary Creature — Elemental Otter', cmc: 3, colors: ['U','R'], colorIdentity: ['U','R'], legalCommander: false },
};

function deckWith(entries, extra = {}) {
  const base = D.newDeck({ nome: 'T' });
  return { ...base, carte: entries, ...extra };
}

test('groupDeck per tipo: gruppi canonici in ordine, CMC crescente dentro il gruppo', () => {
  const deck = deckWith([
    { scryfall_id: 'c-dragon', qty: 1, tags: [] },
    { scryfall_id: 'c-goblin', qty: 1, tags: [] },
    { scryfall_id: 'c-bolt', qty: 1, tags: [] },
    { scryfall_id: 'c-island', qty: 10, tags: [] },
  ]);
  const groups = D.groupDeck(deck, CARDS);
  assert.deepEqual(groups.map((g) => g.name), ['Creature', 'Istantanei', 'Terre']);
  const creature = groups[0].entries.map((e) => e.card.name);
  assert.deepEqual(creature, ['Goblin Guide', 'Shivan Dragon'], 'CMC 1 prima di CMC 6');
});

test('groupDeck per tag: la carta appare UNA volta, nel primo gruppo che matcha', () => {
  const deck = deckWith([
    { scryfall_id: 'c-sol', qty: 1, tags: ['ramp', 'artefatti'] }, // primo tag visto: ramp
    { scryfall_id: 'c-bolt', qty: 1, tags: ['removal'] },
    { scryfall_id: 'c-goblin', qty: 1, tags: [] },
  ], { raggruppamento: 'tag' });
  const groups = D.groupDeck(deck, CARDS);
  assert.deepEqual(groups.map((g) => g.name), ['ramp', 'removal', 'Senza tag']);
  const inRamp = groups[0].entries.map((e) => e.entry.scryfall_id);
  assert.deepEqual(inRamp, ['c-sol'], 'Sol Ring solo in ramp, mai duplicato in artefatti');
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  assert.equal(total, 3, 'ogni carta esattamente una volta');
});

test('groupDeck: l\'override esplicito vince sul raggruppamento naturale', () => {
  let deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: [] }]);
  deck = D.setGroupOverride(deck, 'c-bolt', 'Removal');
  const groups = D.groupDeck(deck, CARDS);
  assert.deepEqual(groups.map((g) => g.name), ['Removal']);
  // Rimuovere l'override riporta la carta nel suo gruppo naturale.
  deck = D.setGroupOverride(deck, 'c-bolt', null);
  assert.deepEqual(D.groupDeck(deck, CARDS).map((g) => g.name), ['Istantanei']);
});

// ─── #316: l'override di gruppo è PER-VISTA, non un valore unico globale ──────

test('setGroupOverride è per-vista: l\'override di una vista non inquina le altre', () => {
  let deck = deckWith([
    { scryfall_id: 'c-sol', qty: 1, tags: [] },     // Artefatti, cmc 1, Incolore
    { scryfall_id: 'c-island', qty: 1, tags: [] },  // Terre, cmc 0
  ], { raggruppamento: 'tipo' });
  // Sposto Sol Ring nel gruppo "Terre" nella vista PER TIPO.
  deck = D.setGroupOverride(deck, 'c-sol', 'Terre', 'tipo');
  const byType = D.groupDeck(deck, CARDS);
  assert.ok(byType.find((g) => g.name === 'Terre').entries.some((e) => e.entry.scryfall_id === 'c-sol'),
    'nella vista per tipo l\'override vale: Sol Ring è in Terre');
  // Passando alla vista PER COSTO DI MANA Sol Ring torna nel bucket del suo
  // costo (1), NON nel gruppo alieno "Terre" (il bug del feedback #316).
  const byCmc = D.groupDeck({ ...deck, raggruppamento: 'cmc' }, CARDS);
  assert.ok(byCmc.find((g) => g.name === '1').entries.some((e) => e.entry.scryfall_id === 'c-sol'),
    'nella vista per costo Sol Ring è nel bucket 1');
  assert.ok(!byCmc.some((g) => g.name === 'Terre'), 'nessun gruppo alieno "Terre" tra i bucket numerici');
  // Tornando alla vista per tipo l'override è ancora lì (per-vista, non perso).
  const back = D.groupDeck({ ...deck, raggruppamento: 'tipo' }, CARDS);
  assert.ok(back.find((g) => g.name === 'Terre').entries.some((e) => e.entry.scryfall_id === 'c-sol'),
    'l\'override della vista per tipo sopravvive al giro tra le viste');
});

test('setGroupOverride: viste diverse hanno override indipendenti; reset per-vista', () => {
  let deck = deckWith([{ scryfall_id: 'c-sol', qty: 1, tags: [] }], { raggruppamento: 'tipo' });
  deck = D.setGroupOverride(deck, 'c-sol', 'Terre', 'tipo');
  deck = D.setGroupOverride(deck, 'c-sol', 'Rampa', 'cmc');
  assert.deepEqual(deck.carte[0].gruppo_override, { tipo: 'Terre', cmc: 'Rampa' });
  // Il reset di UNA vista lascia intatte le altre.
  deck = D.setGroupOverride(deck, 'c-sol', null, 'tipo');
  assert.deepEqual(deck.carte[0].gruppo_override, { cmc: 'Rampa' });
  // Rimosso anche l'ultimo, il campo sparisce (storage pulito).
  deck = D.setGroupOverride(deck, 'c-sol', null, 'cmc');
  assert.equal(deck.carte[0].gruppo_override, undefined);
});

test('setGroupOverride: stesso override due volte è no-op (versione ferma)', () => {
  let deck = deckWith([{ scryfall_id: 'c-sol', qty: 1, tags: [] }], { raggruppamento: 'tipo' });
  deck = D.setGroupOverride(deck, 'c-sol', 'Terre', 'tipo');
  const v = deck.versione;
  const again = D.setGroupOverride(deck, 'c-sol', 'Terre', 'tipo');
  assert.equal(again, deck, 'stesso riferimento: nessun edit');
  assert.equal(again.versione, v);
  // Anche il reset di una vista senza override è un no-op.
  const noReset = D.setGroupOverride(deck, 'c-sol', null, 'colore');
  assert.equal(noReset, deck);
});

test('setGroupOverride senza vista esplicita usa il raggruppamento corrente del mazzo', () => {
  let deck = deckWith([{ scryfall_id: 'c-sol', qty: 1, tags: [] }], { raggruppamento: 'colore' });
  deck = D.setGroupOverride(deck, 'c-sol', 'Speciale');
  assert.deepEqual(deck.carte[0].gruppo_override, { colore: 'Speciale' });
});

test('sanitizeDeck migra un override legacy (stringa) alla vista corrente del mazzo', () => {
  const d = D.sanitizeDeck({
    id: 'x', raggruppamento: 'cmc',
    carte: [{ scryfall_id: 'a', qty: 1, gruppo_override: 'Terre' }],
  });
  assert.deepEqual(d.carte[0].gruppo_override, { cmc: 'Terre' },
    'la stringa legacy diventa una mappa per la vista corrente, non inquina le altre');
});

test('sanitizeDeck ripulisce una mappa override da chiavi/valori spuri', () => {
  const d = D.sanitizeDeck({
    id: 'x', raggruppamento: 'tipo',
    carte: [{ scryfall_id: 'a', qty: 1, gruppo_override: { tipo: 'Terre', boh: 'X', cmc: '  ' } }],
  });
  assert.deepEqual(d.carte[0].gruppo_override, { tipo: 'Terre' });
});

// ─── #344: trascina una carta su una categoria → aggiungi/sostituisci tag ─────

test('addTagToCard aggiunge il tag e incrementa la versione; il doppione è no-op', () => {
  const deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: ['removal'] }], { raggruppamento: 'tag' });
  const v0 = deck.versione;
  const d1 = D.addTagToCard(deck, 'c-bolt', 'burn');
  assert.deepEqual(d1.carte[0].tags, ['removal', 'burn'], 'il nuovo tag si aggiunge in coda');
  assert.equal(d1.versione, v0 + 1, 'una modifica reale avanza la versione');
  // Ora la carta compare anche sotto il nuovo tag se ci si raggruppa: prova groupDeck.
  const d2 = D.addTagToCard(d1, 'c-bolt', 'burn');
  assert.equal(d2, d1, 'aggiungere un tag già presente non tocca il mazzo');
});

test('replaceCardTags sostituisce tutti i tag; [] li rimuove tutti', () => {
  const deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: ['removal', 'burn'] }], { raggruppamento: 'tag' });
  const rep = D.replaceCardTags(deck, 'c-bolt', ['ramp']);
  assert.deepEqual(rep.carte[0].tags, ['ramp'], 'i vecchi tag spariscono, resta solo il nuovo');
  const cleared = D.replaceCardTags(rep, 'c-bolt', []);
  assert.deepEqual(cleared.carte[0].tags, [], 'insieme vuoto = nessun tag');
  const noop = D.replaceCardTags(cleared, 'c-bolt', []);
  assert.equal(noop, cleared, 'sostituire con un insieme identico è no-op');
});

test('replaceCardTags normalizza (trim) e rende unici i tag', () => {
  const deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: [] }], { raggruppamento: 'tag' });
  const rep = D.replaceCardTags(deck, 'c-bolt', [' ramp ', 'ramp', '', 'draw']);
  assert.deepEqual(rep.carte[0].tags, ['ramp', 'draw']);
});

test('addTagToCard/replaceCardTags rimuovono l\'override di gruppo: in vista tag la carta compare sotto il nuovo tag', () => {
  let deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: ['removal'] }], { raggruppamento: 'tag' });
  deck = D.setGroupOverride(deck, 'c-bolt', 'Forzato');
  assert.deepEqual(D.groupDeck(deck, CARDS).map((g) => g.name), ['Forzato'], 'l\'override forza il gruppo');
  // Trascinandola su un tag l\'override cede e la carta finisce sotto quel tag.
  const dropped = D.addTagToCard(deck, 'c-bolt', 'burn');
  assert.equal(dropped.carte[0].gruppo_override, undefined, 'l\'override manuale viene rimosso');
  assert.ok(D.groupDeck(dropped, CARDS).some((g) => g.name === 'removal'), 'la carta torna raggruppata per tag');
});

test('addTagToCard/replaceCardTags su carta inesistente = mazzo INVARIATO', () => {
  const deck = deckWith([{ scryfall_id: 'c-bolt', qty: 1, tags: ['removal'] }], { raggruppamento: 'tag' });
  assert.equal(D.addTagToCard(deck, 'ignoto', 'x'), deck);
  assert.equal(D.replaceCardTags(deck, 'ignoto', ['x']), deck);
  assert.equal(D.addTagToCard(deck, 'c-bolt', '   '), deck, 'tag vuoto = niente da fare');
});

test('groupDeck per cmc e per colore', () => {
  const deck = deckWith([
    { scryfall_id: 'c-bolt', qty: 1, tags: [] },
    { scryfall_id: 'c-dragon', qty: 1, tags: [] },
    { scryfall_id: 'c-sol', qty: 1, tags: [] },
  ], { raggruppamento: 'cmc' });
  assert.deepEqual(D.groupDeck(deck, CARDS).map((g) => g.name), ['1', '6']);
  const byColor = D.groupDeck({ ...deck, raggruppamento: 'colore' }, CARDS);
  assert.deepEqual(byColor.map((g) => g.name), ['Rosso', 'Incolore']);
});

// ─── Task 4: legalità Commander (§8.4) ────────────────────────────────────────

test('legalityChecks: singleton viola su duplicati ma NON sulle basic land', () => {
  const deck = deckWith([
    { scryfall_id: 'c-island', qty: 24, tags: [] },   // basics: qty libera
    { scryfall_id: 'c-bolt', qty: 2, tags: [] },      // viola: qty 2
    { scryfall_id: 'c-goblin', qty: 1, tags: [] },
    { scryfall_id: 'c-goblin', qty: 1, tags: [] },    // viola: doppione
  ]);
  const r = D.legalityChecks(deck, CARDS);
  assert.equal(r.singleton.ok, false);
  assert.deepEqual(r.singleton.violations, ['Lightning Bolt', 'Goblin Guide']);
});

test('legalityChecks: identity per carta rispetto al commander; senza commander nessun check', () => {
  const entries = [
    { scryfall_id: 'c-island', qty: 1, tags: [] },  // identity U: fuori da un mazzo mono-R
    { scryfall_id: 'c-bolt', qty: 1, tags: [] },
  ];
  const withCmd = deckWith(entries, { commander: 'c-dragon', commanderMeta: { name: 'Shivan', colors: ['R'] } });
  const r = D.legalityChecks(withCmd, CARDS);
  assert.equal(r.identity.ok, false);
  assert.deepEqual(r.identity.violations, ['Island']);
  const noCmd = deckWith(entries);
  assert.equal(D.legalityChecks(noCmd, CARDS).identity.ok, true);
});

test('legalityChecks: banned list e conteggio con commander', () => {
  const deck = deckWith([
    { scryfall_id: 'c-lutri', qty: 1, tags: [] },   // banned in Commander
    { scryfall_id: 'c-bolt', qty: 1, tags: [] },
  ], { commander: 'c-dragon', commanderMeta: { name: 'Shivan', colors: ['U','R'] } });
  const r = D.legalityChecks(deck, CARDS);
  assert.equal(r.banned.ok, false);
  assert.deepEqual(r.banned.violations, ['Lutri, the Spellchaser']);
  assert.equal(r.count, 3, '2 carte + il commander');
});

test('setRaggruppamento cambia vista e versione; vista invalida ignorata', () => {
  const deck = D.newDeck();
  const r = D.setRaggruppamento(deck, 'cmc');
  assert.equal(r.raggruppamento, 'cmc');
  assert.equal(r.versione, deck.versione + 1);
  assert.equal(D.setRaggruppamento(deck, 'boh'), deck);
  assert.equal(D.setRaggruppamento(deck, 'tipo'), deck, 'stessa vista: nessun edit');
});

// mergeCard — copia/sposta verso un altro mazzo: mai un no-op silenzioso.
// Se la carta manca si comporta come addCard; se c'è già SOMMA le quantità
// (10 Island spostate su un mazzo con 1 Island → 11, non 1) e unisce i tag.
test('mergeCard su carta assente aggiunge come addCard', () => {
  const d = D.newDeck();
  const { deck, added, merged } = D.mergeCard(d, 'c-island', { qty: 10, tags: ['mana'] });
  assert.equal(added, true);
  assert.equal(merged, false);
  assert.equal(deck.carte[0].qty, 10);
  assert.deepEqual(deck.carte[0].tags, ['mana']);
  assert.equal(deck.versione, d.versione + 1);
});

test('mergeCard su carta già presente SOMMA le quantità e unisce i tag', () => {
  const { deck: d1 } = D.addCard(D.newDeck(), 'c-island', { qty: 1, tags: ['base'] });
  const { deck: d2, added, merged } = D.mergeCard(d1, 'c-island', { qty: 10, tags: ['mana', 'base'] });
  assert.equal(added, false);
  assert.equal(merged, true);
  assert.equal(d2.carte.length, 1, 'nessun doppione');
  assert.equal(d2.carte[0].qty, 11, 'le copie si conservano: 1 + 10');
  assert.deepEqual(d2.carte[0].tags, ['base', 'mana'], 'union senza duplicati');
  assert.equal(d2.versione, d1.versione + 1);
});

test('mergeCard con id vuoto è un no-op esplicito', () => {
  const d = D.newDeck();
  const { deck, added, merged } = D.mergeCard(d, '  ');
  assert.equal(added, false);
  assert.equal(merged, false);
  assert.equal(deck, d);
});

// ── Budget con la virgola decimale italiana (#315) ──────────────────────────
// L'app mostra i prezzi come «12,50 €»: il tetto scritto allo stesso modo va
// parsato, non stravolto (prima «40,50» diventava 4050, x100 in silenzio).

test('parseBudgetInput accetta virgola e punto come separatore decimale', () => {
  assert.deepEqual(D.parseBudgetInput('40,50'), { ok: true, value: 40.5 });
  assert.deepEqual(D.parseBudgetInput('40.50'), { ok: true, value: 40.5 });
  assert.deepEqual(D.parseBudgetInput('100'), { ok: true, value: 100 });
  assert.deepEqual(D.parseBudgetInput('0'), { ok: true, value: 0 });
});

test('parseBudgetInput tollera €, spazi e separatore delle migliaia', () => {
  assert.deepEqual(D.parseBudgetInput(' 40,50 € '), { ok: true, value: 40.5 });
  assert.deepEqual(D.parseBudgetInput('1.234,56'), { ok: true, value: 1234.56 });
  assert.deepEqual(D.parseBudgetInput('1,234.56'), { ok: true, value: 1234.56 });
});

test('parseBudgetInput: vuoto/null = nessun tetto (rimozione esplicita)', () => {
  assert.deepEqual(D.parseBudgetInput(''), { ok: true, value: null });
  assert.deepEqual(D.parseBudgetInput('   '), { ok: true, value: null });
  assert.deepEqual(D.parseBudgetInput(null), { ok: true, value: null });
  assert.deepEqual(D.parseBudgetInput(undefined), { ok: true, value: null });
});

test('parseBudgetInput rifiuta il testo non numerico (mai ok con valore stravolto)', () => {
  for (const bad of ['abc', '40,5,0', '4a0', '-5', '40..5', '..', ',']) {
    assert.deepEqual(D.parseBudgetInput(bad), { ok: false }, `«${bad}» deve essere rifiutato`);
  }
});

test('setBudget con stringa passa dal parser: virgola ok, testo invalido = mazzo INVARIATO', () => {
  const d = D.setBudget(D.newDeck(), 100);
  assert.equal(d.budget, 100);
  const conVirgola = D.setBudget(d, '40,50');
  assert.equal(conVirgola.budget, 40.5, 'la virgola è un decimale, non va scartata');
  const invalido = D.setBudget(d, 'abc');
  assert.equal(invalido, d, 'input non numerico: nessuna modifica silenziosa');
  assert.equal(invalido.budget, 100, 'il tetto precedente sopravvive');
  const rimosso = D.setBudget(d, '');
  assert.equal(rimosso.budget, null, 'stringa vuota = rimozione del tetto');
});
