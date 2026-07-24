// Unit test per src/shared/deckStats.js — statistiche del mazzo (§9) e motore
// Monte Carlo del calcolatore di probabilità (§9.3). Il Monte Carlo è
// confrontato con l'ORACOLO ipergeometrico calcolato in modo esatto qui nel
// test (casi a categoria singola, dove la formula chiusa esiste); i tag
// sovrapposti si verificano con casi deterministici in cui il matching è
// l'unica risposta giusta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
require(join(__dirname, '..', '..', 'src', 'shared', 'decks.js'));
require(join(__dirname, '..', '..', 'src', 'shared', 'deckStats.js'));

const S = globalThis.SN_DECK_STATS;

// ── Fixture: carte semplificate come quelle di SN_SCRYFALL_Q.simplifyCard ──
const CARDS = {
  land: { id: 'land', name: 'Steam Vents', typeLine: 'Land — Island Mountain', cmc: 0, manaCost: '', priceEur: 12, producedMana: ['U', 'R'] },
  basic: { id: 'basic', name: 'Island', typeLine: 'Basic Land — Island', cmc: 0, manaCost: '', priceEur: 0.1, producedMana: ['U'] },
  rock: { id: 'rock', name: 'Sol Ring', typeLine: 'Artifact', cmc: 1, manaCost: '{1}', priceEur: 1.5, producedMana: ['C'] },
  bolt: { id: 'bolt', name: 'Lightning Bolt', typeLine: 'Instant', cmc: 1, manaCost: '{R}', priceEur: 1.1, producedMana: [] },
  hybrid: { id: 'hybrid', name: 'Hybrid Guy', typeLine: 'Creature — Test', cmc: 2, manaCost: '{W/U}{U}', priceEur: null, producedMana: [] },
  phyrexian: { id: 'phyrexian', name: 'Phyrexian Guy', typeLine: 'Sorcery', cmc: 9, manaCost: '{7}{G/P}{G/P}', priceEur: 0.5, producedMana: [] },
  cmdr: { id: 'cmdr', name: 'Niv-Mizzet', typeLine: 'Legendary Creature — Dragon', cmc: 6, manaCost: '{U}{U}{U}{R}{R}{R}', priceEur: 3, producedMana: [] },
};

function deckOf(entries, extra = {}) {
  return { id: 'd1', nome: 'Test', commander: '', commanderMeta: null, carte: entries, raggruppamento: 'tipo', budget: null, versione: 1, ...extra };
}
const e = (id, opts = {}) => ({ scryfall_id: id, qty: opts.qty || 1, tags: opts.tags || [] });

test('deckStats si registra su globalThis con la sua API', () => {
  assert.ok(S);
  for (const fn of ['manaCurve', 'avgCmc', 'pipCounts', 'producedCounts', 'typeCounts', 'budgetInfo', 'buildLibrary', 'categoriesOf', 'handSatisfies', 'simulate']) {
    assert.equal(typeof S[fn], 'function', `manca ${fn}`);
  }
});

test('manaCurve: istogramma per CMC, terre escluse, 7+ raggruppato, qty pesata', () => {
  const deck = deckOf([e('land'), e('bolt', { qty: 2 }), e('hybrid'), e('phyrexian')]);
  const curve = S.manaCurve(deck, CARDS);
  const byLabel = Object.fromEntries(curve.map((b) => [b.label, b.n]));
  assert.equal(byLabel['0'], 0); // la terra NON entra nella curva
  assert.equal(byLabel['1'], 2);
  assert.equal(byLabel['2'], 1);
  assert.equal(byLabel['7+'], 1);
  assert.equal(curve.length, 8);
});

test('avgCmc: media pesata per quantità, terre escluse; null senza incantesimi', () => {
  const deck = deckOf([e('bolt', { qty: 3 }), e('cmdr'), e('land', { qty: 10 })]);
  assert.equal(S.avgCmc(deck, CARDS), (1 * 3 + 6) / 4);
  assert.equal(S.avgCmc(deckOf([e('land')]), CARDS), null);
});

test('pipCounts: conta i pip colorati; ibridi contano per ogni colore, generici/Phyrexian no', () => {
  const deck = deckOf([e('bolt'), e('hybrid'), e('phyrexian'), e('rock')]);
  const p = S.pipCounts(deck, CARDS);
  assert.equal(p.R, 1);           // {R}
  assert.equal(p.W, 1);           // {W/U} conta W…
  assert.equal(p.U, 2);           // …e U, più la {U} secca
  assert.equal(p.G, 2);           // {G/P} conta G, due simboli
  assert.equal(p.B, 0);
});

test('producedCounts: fonti per colore dai dati carta; C solo per fonti incolori pure', () => {
  const deck = deckOf([e('land'), e('basic', { qty: 4 }), e('rock'), e('bolt')]);
  const p = S.producedCounts(deck, CARDS);
  assert.equal(p.U, 5);  // Steam Vents + 4 Island
  assert.equal(p.R, 1);  // Steam Vents
  assert.equal(p.C, 1);  // Sol Ring
  assert.equal(p.W + p.B + p.G, 0);
});

test('typeCounts: conteggio per tipo nell\'ordine canonico', () => {
  const deck = deckOf([e('land'), e('basic', { qty: 2 }), e('bolt'), e('cmdr')]);
  const t = S.typeCounts(deck, CARDS);
  assert.deepEqual(t, [
    { name: 'Creature', n: 1 },
    { name: 'Istantanei', n: 1 },
    { name: 'Terre', n: 3 },
  ]);
});

test('budgetInfo: totale EUR (commander incluso), residuo e prezzi mancanti', () => {
  const deck = deckOf([e('bolt', { qty: 2 }), e('hybrid'), e('rock')], { commander: 'cmdr', budget: 10 });
  const b = S.budgetInfo(deck, CARDS);
  assert.equal(b.total, 1.1 * 2 + 1.5 + 3); // hybrid senza prezzo
  assert.equal(b.missing, 1);
  assert.equal(b.budget, 10);
  assert.ok(Math.abs(b.residuo - (10 - b.total)) < 1e-9);
  assert.equal(S.budgetInfo(deckOf([e('bolt')]), CARDS).budget, null);
});

test('buildLibrary: espande le quantità, aggiunge "terre" alle terre, normalizza i tag', () => {
  const deck = deckOf([e('basic', { qty: 3 }), e('bolt', { tags: ['Removal', 'BURN'] })]);
  const lib = S.buildLibrary(deck, CARDS);
  assert.equal(lib.length, 4);
  assert.equal(lib.filter((tags) => tags.includes('terre')).length, 3);
  assert.deepEqual(lib[3].sort(), ['burn', 'removal']);
});

test('categoriesOf: tag del mazzo in ordine di apparizione + "terre" se ci sono terre', () => {
  const deck = deckOf([e('bolt', { tags: ['Ramp'] }), e('rock', { tags: ['ramp', 'rock'] }), e('basic')]);
  assert.deepEqual(S.categoriesOf(deck, CARDS), ['ramp', 'rock', 'terre']);
  assert.deepEqual(S.categoriesOf(deckOf([e('bolt')]), CARDS), []);
});

test('handSatisfies: i tag sovrapposti coprono UNA sola richiesta (matching, non conteggio)', () => {
  // Una carta ramp+draw non può valere sia come ramp che come draw.
  assert.equal(S.handSatisfies([['ramp', 'draw']], [{ tag: 'ramp', n: 1 }, { tag: 'draw', n: 1 }]), false);
  // Due carte entrambe ramp+draw: una copre ramp, l'altra draw.
  assert.equal(S.handSatisfies([['ramp', 'draw'], ['ramp', 'draw']], [{ tag: 'ramp', n: 1 }, { tag: 'draw', n: 1 }]), true);
  // Il matching deve saper RIASSEGNARE: [a] e [a,b] con richiesta a1+b1 —
  // se [a,b] viene presa per "a" in modo greedy, "b" resta scoperta.
  assert.equal(S.handSatisfies([['a', 'b'], ['a']], [{ tag: 'a', n: 1 }, { tag: 'b', n: 1 }]), true);
  assert.equal(S.handSatisfies([['a']], [{ tag: 'a', n: 2 }]), false);
});

// ── Oracolo ipergeometrico: P(X >= k) pescando n carte da N con K successi ──
function comb(a, b) {
  if (b < 0 || b > a) return 0;
  let r = 1;
  for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
  return r;
}
function hyperAtLeast(N, K, n, k) {
  let p = 0;
  for (let x = k; x <= Math.min(K, n); x++) {
    p += (comb(K, x) * comb(N - K, n - x)) / comb(N, n);
  }
  return p;
}

test('simulate ≈ ipergeometrica: 3+ terre al turno 4 con 40 terre su 99', () => {
  const library = [
    ...Array.from({ length: 40 }, () => ['terre']),
    ...Array.from({ length: 59 }, () => []),
  ];
  // Turno 4 "on the play": 7 + 3 = 10 carte viste.
  const r = S.simulate({ library, want: [{ tag: 'terre', n: 3 }], turn: 4, iterations: 20000, seed: 42 });
  assert.equal(r.seen, 10);
  const oracle = hyperAtLeast(99, 40, 10, 3);
  assert.ok(Math.abs(r.probability - oracle) < 0.02,
    `Monte Carlo ${r.probability} vs oracolo ${oracle.toFixed(4)}`);
});

test('simulate ≈ ipergeometrica: caso stretto (2 combo su 99, turno 10)', () => {
  const library = [
    ...Array.from({ length: 2 }, () => ['combo']),
    ...Array.from({ length: 97 }, () => []),
  ];
  const r = S.simulate({ library, want: [{ tag: 'combo', n: 1 }], turn: 10, iterations: 20000, seed: 7 });
  const oracle = hyperAtLeast(99, 2, 16, 1); // 7 + 9 = 16 carte viste
  assert.ok(Math.abs(r.probability - oracle) < 0.02,
    `Monte Carlo ${r.probability} vs oracolo ${oracle.toFixed(4)}`);
});

test('simulate: casi certi — richiesta impossibile = 0, richiesta vuota = 1, tutto visto = 1', () => {
  const lib10 = Array.from({ length: 10 }, () => ['terre']);
  assert.equal(S.simulate({ library: lib10, want: [{ tag: 'terre', n: 11 }], turn: 1, seed: 1 }).probability, 0);
  assert.equal(S.simulate({ library: lib10, want: [], turn: 1, seed: 1 }).probability, 1);
  // 8 terre richieste: al turno 1 vedi 7 carte (impossibile), al turno 2 ne
  // vedi 8 (tutte terre: certo).
  assert.equal(S.simulate({ library: lib10, want: [{ tag: 'terre', n: 8 }], turn: 1, iterations: 500, seed: 1 }).probability, 0);
  assert.equal(S.simulate({ library: lib10, want: [{ tag: 'terre', n: 8 }], turn: 2, iterations: 500, seed: 1 }).probability, 1);
});

test('simulate: onDraw ed extraDraws aumentano le carte viste', () => {
  const lib = Array.from({ length: 9 }, () => ['x']);
  assert.equal(S.simulate({ library: lib, want: [{ tag: 'x', n: 8 }], turn: 1, onDraw: true, iterations: 100, seed: 3 }).probability, 1);
  assert.equal(S.simulate({ library: lib, want: [{ tag: 'x', n: 9 }], turn: 1, onDraw: true, extraDraws: 1, iterations: 100, seed: 3 }).probability, 1);
});

test('simulate: il mulligan con regola di keep alza la probabilità', () => {
  // 7 carte "combo" su 28: chi mulliga finché non ne vede una parte avvantaggiato.
  const library = [
    ...Array.from({ length: 7 }, () => ['combo']),
    ...Array.from({ length: 21 }, () => []),
  ];
  const base = S.simulate({ library, want: [{ tag: 'combo', n: 1 }], turn: 1, iterations: 20000, seed: 11 });
  const mull = S.simulate({
    library, want: [{ tag: 'combo', n: 1 }], turn: 1, iterations: 20000, seed: 11,
    mulligans: 3, keep: [{ tag: 'combo', n: 1 }],
  });
  assert.ok(mull.probability > base.probability + 0.05,
    `mulligan ${mull.probability} vs base ${base.probability}`);
});

test('simulate: deterministico a parità di seed', () => {
  const library = [
    ...Array.from({ length: 40 }, () => ['terre']),
    ...Array.from({ length: 59 }, () => []),
  ];
  const a = S.simulate({ library, want: [{ tag: 'terre', n: 3 }], turn: 4, iterations: 2000, seed: 5 });
  const b = S.simulate({ library, want: [{ tag: 'terre', n: 3 }], turn: 4, iterations: 2000, seed: 5 });
  assert.equal(a.probability, b.probability);
});

// Feedback #354: la stima si raffina accumulando più batch con seed diversi
// (Σhits/Σiterations). Verifica che `hits` sia esatto (hits/iterations ===
// probability) e che accumulare tanti batch converga verso l'oracolo
// ipergeometrico MEGLIO di un singolo batch piccolo — è il cuore del "converge
// verso la vera probabilità" chiesto dall'utente.
test('simulate: hits è esatto e accumulare batch converge (feedback #354)', () => {
  const library = [
    ...Array.from({ length: 40 }, () => ['terre']),
    ...Array.from({ length: 59 }, () => []),
  ];
  const want = [{ tag: 'terre', n: 3 }];

  // hits/iterations coincide con probability (i due campi sono sommabili).
  const one = S.simulate({ library, want, turn: 4, iterations: 5000, seed: 1 });
  assert.equal(one.hits / one.iterations, one.probability);
  assert.ok(Number.isInteger(one.hits) && one.hits >= 0 && one.hits <= one.iterations);

  // Oracolo ipergeometrico: 3+ terre viste su 40/99 al turno 4 (10 carte).
  const oracle = 1 - hyperAtMost(2, 99, 40, 10);

  // Un singolo batch da 15k vs 40 batch accumulati (600k mani): l'accumulato
  // dev'essere almeno buono quanto il singolo, e molto vicino all'oracolo.
  const small = S.simulate({ library, want, turn: 4, iterations: 15000, seed: 1 });
  let hits = 0; let iters = 0;
  for (let s = 1; s <= 40; s++) {
    const r = S.simulate({ library, want, turn: 4, iterations: 15000, seed: s });
    hits += r.hits; iters += r.iterations;
  }
  const converged = hits / iters;
  assert.equal(iters, 600000);
  assert.ok(Math.abs(converged - oracle) < 0.003,
    `accumulato ${converged} vs oracolo ${oracle.toFixed(4)}`);
  assert.ok(Math.abs(converged - oracle) <= Math.abs(small.probability - oracle) + 1e-9,
    `accumulato (${converged}) non più lontano del singolo batch (${small.probability})`);
});
