// Statistiche del mazzo Commander, logica pura su (deck, cardsById): curva, pip, budget.
// Più il Monte Carlo del calcolatore di probabilità (DECK-BUILDER-SPEC.md §9.3).

(function (global) {
  'use strict';

  const WUBRG = ['W', 'U', 'B', 'R', 'G'];
  const CMC_BUCKETS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

  function qtyOf(entry) { return Math.max(1, Number(entry && entry.qty) || 1); }

  function isLand(card) {
    const t = String((card && card.typeLine) || '').split('//')[0];
    return /\bLand\b/i.test(t);
  }

  // Terre ESCLUSE: la curva misura gli incantesimi da lanciare, e le terre non si lanciano.
  function manaCurve(deck, cardsById) {
    const counts = Object.fromEntries(CMC_BUCKETS.map((b) => [b, 0]));
    for (const e of deck.carte) {
      const card = cardsById[e.scryfall_id];
      if (!card || isLand(card)) continue;
      const n = Math.floor(Number(card.cmc) || 0);
      counts[n >= 7 ? '7+' : String(Math.max(0, n))] += qtyOf(e);
    }
    return CMC_BUCKETS.map((label) => ({ label, n: counts[label] }));
  }

  // Sulle non-terra, pesato per quantità. Null se non ce ne sono.
  function avgCmc(deck, cardsById) {
    let sum = 0; let n = 0;
    for (const e of deck.carte) {
      const card = cardsById[e.scryfall_id];
      if (!card || isLand(card)) continue;
      sum += (Number(card.cmc) || 0) * qtyOf(e);
      n += qtyOf(e);
    }
    return n ? sum / n : null;
  }

  // Un simbolo ibrido conta per OGNI colore che contiene: è un requisito potenziale.
  // Generici, X e incolore non contano.
  function pipCounts(deck, cardsById) {
    const out = Object.fromEntries(WUBRG.map((c) => [c, 0]));
    const re = /\{([^}]+)\}/g;
    for (const e of deck.carte) {
      const card = cardsById[e.scryfall_id];
      if (!card || !card.manaCost) continue;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(card.manaCost))) {
        const parts = String(m[1]).toUpperCase().split('/');
        const seen = new Set();
        for (const p of parts) {
          if (WUBRG.includes(p) && !seen.has(p)) {
            out[p] += qtyOf(e);
            seen.add(p);
          }
        }
      }
    }
    return out;
  }

  // Conta le FONTI, non i pip: una terra che produce U e R vale 1 in U e 1 in R.
  // 'C' sono le fonti di solo incolore.
  function producedCounts(deck, cardsById) {
    const out = Object.fromEntries([...WUBRG, 'C'].map((c) => [c, 0]));
    for (const e of deck.carte) {
      const card = cardsById[e.scryfall_id];
      const prod = (card && Array.isArray(card.producedMana)) ? card.producedMana : [];
      if (!prod.length) continue;
      const colored = prod.filter((c) => WUBRG.includes(String(c).toUpperCase()));
      for (const c of colored) out[String(c).toUpperCase()] += qtyOf(e);
      if (!colored.length && prod.some((c) => String(c).toUpperCase() === 'C')) {
        out.C += qtyOf(e);
      }
    }
    return out;
  }

  // La classificazione la fa SN_DECKS.tipoOf, la stessa dei gruppi del mazzo.
  function typeCounts(deck, cardsById) {
    const D = global.SN_DECKS;
    const counts = new Map();
    for (const e of deck.carte) {
      const t = D.tipoOf(cardsById[e.scryfall_id]);
      counts.set(t, (counts.get(t) || 0) + qtyOf(e));
    }
    const order = D.TIPO_ORDINE;
    return [...counts.entries()]
      .sort((a, b) => {
        const ia = order.indexOf(a[0]); const ib = order.indexOf(b[0]);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, n]) => ({ name, n }));
  }

  // Totale EUR col commander incluso: si compra anche lui.
  // `missing` sono le carte senza prezzo noto.
  function budgetInfo(deck, cardsById) {
    let total = 0; let missing = 0;
    const addPrice = (id, qty) => {
      const card = cardsById[id];
      if (card && card.priceEur != null) total += card.priceEur * qty;
      else missing += qty;
    };
    for (const e of deck.carte) addPrice(e.scryfall_id, qtyOf(e));
    if (deck.commander) addPrice(deck.commander, 1);
    const budget = (deck.budget === null || deck.budget === undefined) ? null : Number(deck.budget);
    return {
      total,
      missing,
      budget,
      residuo: budget === null ? null : budget - total,
    };
  }

  // Libreria = mazzo espanso per quantità, commander escluso: sta in zona di comando.
  // Si simula invece della formula chiusa: una carta con due tag copre UNA sola richiesta.

  const LAND_TAG = 'terre';

  function normTag(t) { return String(t || '').trim().toLowerCase(); }

  // Una entry per COPIA di carta.
  function buildLibrary(deck, cardsById) {
    const lib = [];
    for (const e of deck.carte) {
      const card = cardsById[e.scryfall_id];
      const tags = new Set((e.tags || []).map(normTag).filter(Boolean));
      if (card && isLand(card)) tags.add(LAND_TAG);
      const arr = [...tags];
      for (let i = 0; i < qtyOf(e); i++) lib.push(arr);
    }
    return lib;
  }

  // Tag del mazzo in ordine di prima apparizione, più «terre» se ce ne sono.
  function categoriesOf(deck, cardsById) {
    const seen = [];
    for (const e of deck.carte) {
      for (const t of e.tags || []) {
        const n = normTag(t);
        if (n && !seen.includes(n)) seen.push(n);
      }
    }
    const hasLand = deck.carte.some((e) => isLand(cardsById[e.scryfall_id]));
    if (hasLand && !seen.includes(LAND_TAG)) seen.push(LAND_TAG);
    return seen;
  }

  // RNG deterministico: stesse pescate a parità di seed, così i test non sono flaky.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Matching bipartito (Kuhn): ogni carta copre al più UNA unità di richiesta.
  function handSatisfies(drawn, want) {
    const units = [];
    for (const w of want) for (let k = 0; k < w.n; k++) units.push(w.tag);
    if (!units.length) return true;
    const ownerOf = new Array(drawn.length).fill(-1); // carta → unità che copre
    const tryAssign = (u, visited) => {
      for (let c = 0; c < drawn.length; c++) {
        if (visited[c] || !drawn[c].includes(units[u])) continue;
        visited[c] = true;
        if (ownerOf[c] < 0 || tryAssign(ownerOf[c], visited)) {
          ownerOf[c] = u;
          return true;
        }
      }
      return false;
    };
    for (let u = 0; u < units.length; u++) {
      if (!tryAssign(u, new Array(drawn.length).fill(false))) return false;
    }
    return true;
  }

  // 7 + (N-1) carte viste al turno N; `mulligans` rifà la mano con una carta in meno.
  // `hits` e `iterations` sono ESATTI e sommabili: la UI raffina accumulando altri batch.
  function simulate({ library, want, turn, onDraw = false, extraDraws = 0, mulligans = 0, keep = null, iterations = 10000, seed } = {}) {
    const lib = Array.isArray(library) ? library : [];
    const reqs = (Array.isArray(want) ? want : [])
      .map((w) => ({ tag: normTag(w.tag), n: Math.max(0, Math.floor(Number(w.n) || 0)) }))
      .filter((w) => w.tag && w.n > 0);
    const t = Math.max(1, Math.floor(Number(turn) || 1));
    const iters = Math.max(1, Math.floor(Number(iterations) || 10000));
    const totalWanted = reqs.reduce((s, w) => s + w.n, 0);
    const laterDraws = (t - 1) + (onDraw ? 1 : 0) + Math.max(0, Math.floor(Number(extraDraws) || 0));

    if (!reqs.length) return { probability: 1, hits: iters, iterations: iters, seen: Math.min(lib.length, 7 + laterDraws) };
    if (!lib.length || totalWanted > lib.length) return { probability: 0, hits: 0, iterations: iters, seen: 0 };

    const rng = mulberry32(Number.isFinite(Number(seed)) ? Number(seed) : (Date.now() & 0xffffffff));
    const keepReqs = (Array.isArray(keep) ? keep : [])
      .map((w) => ({ tag: normTag(w.tag), n: Math.max(0, Math.floor(Number(w.n) || 0)) }))
      .filter((w) => w.tag && w.n > 0);
    const idx = lib.map((_, i) => i);
    let hits = 0;
    let seen = 0;

    for (let it = 0; it < iters; it++) {
      // Fisher-Yates parziale: si mescolano solo le posizioni [from, to).
      const shuffleRange = (from, to) => {
        for (let i = from; i < Math.min(to, idx.length - 1); i++) {
          const j = i + Math.floor(rng() * (idx.length - i));
          const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
        }
      };

      // La mano tenuta resta nelle prime `handSize` posizioni: le pescate escono dal resto.
      let handSize = Math.min(7, lib.length);
      shuffleRange(0, handSize);
      if (keepReqs.length && mulligans > 0) {
        let taken = 0;
        for (;;) {
          const hand = [];
          for (let i = 0; i < handSize; i++) hand.push(lib[idx[i]]);
          if (handSatisfies(hand, keepReqs) || taken >= mulligans || handSize <= 1) break;
          taken++;
          handSize = Math.max(1, handSize - 1);
          shuffleRange(0, handSize);
        }
      }

      const total = Math.min(lib.length, handSize + laterDraws);
      shuffleRange(handSize, total);
      const drawn = [];
      for (let i = 0; i < total; i++) {
        const tags = lib[idx[i]];
        if (tags.length) drawn.push(tags); // le carte senza tag non coprono nulla
      }
      seen = total;
      if (handSatisfies(drawn, reqs)) hits++;
    }

    return { probability: hits / iters, hits, iterations: iters, seen };
  }

  global.SN_DECK_STATS = {
    CMC_BUCKETS,
    LAND_TAG,
    isLand,
    manaCurve,
    avgCmc,
    pipCounts,
    producedCounts,
    typeCounts,
    budgetInfo,
    buildLibrary,
    categoriesOf,
    handSatisfies,
    simulate,
    _mulberry32: mulberry32,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
