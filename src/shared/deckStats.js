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

  // Quante unità di richiesta la mano copre al massimo: matching bipartito
  // carta→unità (algoritmo di Kuhn), ogni carta copre al più UNA unità, così i
  // tag sovrapposti non si contano due volte. `stopAtMiss` esce alla prima unità
  // scoperta (basta per sapere se la richiesta è soddisfatta).
  function coverage(drawn, want, stopAtMiss) {
    const units = [];
    for (const w of want) for (let k = 0; k < w.n; k++) units.push(w.tag);
    const m = drawn.length;
    const ownerOf = new Int32Array(m).fill(-1); // carta → unità che copre
    const visitedIn = new Int32Array(m).fill(-1); // carta → giro che l'ha già provata
    let round = 0;
    const tryAssign = (u) => {
      for (let c = 0; c < m; c++) {
        if (visitedIn[c] === round || !drawn[c].includes(units[u])) continue;
        visitedIn[c] = round;
        if (ownerOf[c] < 0 || tryAssign(ownerOf[c])) {
          ownerOf[c] = u;
          return true;
        }
      }
      return false;
    };
    let covered = 0;
    for (let u = 0; u < units.length; u++) {
      round = u;
      if (tryAssign(u)) covered++;
      else if (stopAtMiss) break;
    }
    return { covered, units: units.length };
  }

  function handSatisfies(drawn, want) {
    // Il conteggio per tag è una condizione necessaria e costa poco: quasi
    // sempre basta a dire di no, e il matching resta per i sì.
    for (const w of want) {
      let c = 0;
      for (let i = 0; i < drawn.length && c < w.n; i++) if (drawn[i].includes(w.tag)) c++;
      if (c < w.n) return false;
    }
    const c = coverage(drawn, want, true);
    return c.covered === c.units;
  }

  // Regole ufficiali 103.5c e 103.8: nelle partite a più giocatori (Commander)
  // nessuno salta la pescata del primo turno e il primo mulligan non mette
  // carte in fondo; a due chi inizia non pesca al primo turno.
  const GAMES = {
    multi: { firstDraw: true, freeMulligan: true, text: 'partita a più giocatori' },
    play: { firstDraw: false, freeMulligan: false, text: 'partita a due, inizi tu' },
    draw: { firstDraw: true, freeMulligan: false, text: 'partita a due, inizia l\'altro' },
  };
  const DEFAULT_GAME = 'multi';
  // La mano da tenere quando si chiede un mulligan senza dire quale: riquadro e chat partono da qui.
  const DEFAULT_KEEP = Object.freeze([Object.freeze({ tag: LAND_TAG, n: 2 })]);
  function gameOf(g) {
    const k = String(g || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(GAMES, k) ? k : DEFAULT_GAME;
  }

  function normReqs(list) {
    return (Array.isArray(list) ? list : [])
      .map((w) => ({ tag: normTag(w && w.tag), n: Math.max(0, Math.floor(Number(w && w.n) || 0)) }))
      .filter((w) => w.tag && w.n > 0);
  }
  const countOf = (n) => Math.max(0, Math.floor(Number(n) || 0));

  // Mulligan London: delle 7 carte pescate ne vanno in fondo `bottom`. Prima
  // quelle che non servono né a `keep` né a `want`; se non bastano, fra le utili
  // si tiene la mano che regge `keep`, poi quella che copre più richiesta, poi
  // quella con più tag richiesti. Ritorna gli indici (in `hand`) delle tenute.
  function keptAfterBottom(hand, bottom, keepReqs, want) {
    const all = hand.map((_, i) => i);
    if (bottom <= 0) return all;
    if (bottom >= hand.length) return [];
    const wantTags = new Set(want.map((w) => w.tag));
    const usefulTags = new Set([...wantTags, ...keepReqs.map((w) => w.tag)]);
    const useful = []; const junk = [];
    for (const i of all) (hand[i].some((t) => usefulTags.has(t)) ? useful : junk).push(i);
    if (bottom <= junk.length) return [...useful, ...junk.slice(bottom)];

    const size = hand.length - bottom;
    const keepable = handSatisfies(hand, keepReqs);
    const wantHits = hand.map((c) => c.filter((t) => wantTags.has(t)).length);
    let best = null; let bestScore = null;
    const pick = [];
    const visit = (start) => {
      if (pick.length === size) {
        const cards = pick.map((i) => hand[i]);
        const score = [
          keepable && handSatisfies(cards, keepReqs) ? 1 : 0,
          coverage(cards, want, false).covered,
          pick.reduce((s, i) => s + wantHits[i], 0),
        ];
        if (!bestScore || (score[0] - bestScore[0] || score[1] - bestScore[1] || score[2] - bestScore[2]) > 0) {
          best = pick.slice(); bestScore = score;
        }
        return;
      }
      for (let k = start; k <= useful.length - (size - pick.length); k++) {
        pick.push(useful[k]); visit(k + 1); pick.pop();
      }
    };
    visit(0);
    return best;
  }

  // Le condizioni della partita dette a parole, per la risposta in chat.
  function describeConditions({ game, mulligans, keep, extraDraws } = {}) {
    const parts = [GAMES[gameOf(game)].text];
    const keepReqs = normReqs(keep);
    const m = countOf(mulligans);
    if (m > 0 && keepReqs.length) {
      parts.push(`fino a ${m} mulligan se la mano non ha almeno ${keepReqs.map((w) => `${w.n} ${w.tag}`).join(' e ')}`);
    } else if (m > 0) {
      parts.push('mulligan non contati: dimmi che mano terresti');
    }
    const x = countOf(extraDraws);
    if (x > 0) parts.push(`${x} ${x === 1 ? 'pescata extra' : 'pescate extra'}`);
    return parts.join('; ');
  }

  // Simulazione: probabilità di avere la "mano desiderata" al turno N.
  //
  //   library    array di array di tag (da buildLibrary)
  //   want       [{ tag, n }] — le categorie richieste (tag normalizzati)
  //   turn       turno N (>=1): si pesca a ogni turno fino all'N-esimo compreso,
  //              tranne al primo se `game` lo salta
  //   game       'multi' (default) | 'play' (a due, inizi tu) | 'draw' (a due,
  //              inizia l'altro): vedi GAMES
  //   extraDraws carte pescate in più entro il turno N (default 0)
  //   mulligans  quante volte al massimo si rifà la mano finché non regge `keep`
  //   keep       [{ tag, n }] — cosa deve avere la mano per tenerla; senza, la
  //              prima mano si tiene sempre
  //   iterations default 10000; seed per run riproducibili.
  //
  // Ritorna { probability, hits, iterations, seen }; `seen` sono le carte viste
  // tenendo la prima mano. `hits`/`iterations` sono ESATTI e sommabili: la UI
  // raffina accumulando batch con seed diversi (probabilità = Σhits/Σiterations).
  function simulate({ library, want, turn, game = DEFAULT_GAME, extraDraws = 0, mulligans = 0, keep = null, iterations = 10000, seed } = {}) {
    const lib = Array.isArray(library) ? library : [];
    const n = lib.length;
    const reqs = normReqs(want);
    const g = GAMES[gameOf(game)];
    const t = Math.max(1, Math.floor(Number(turn) || 1));
    const iters = Math.max(1, Math.floor(Number(iterations) || 10000));
    const totalWanted = reqs.reduce((s, w) => s + w.n, 0);
    const laterDraws = (t - 1) + (g.firstDraw ? 1 : 0) + countOf(extraDraws);
    const h7 = Math.min(7, n);
    const seen = Math.min(n, h7 + laterDraws);

    if (!reqs.length) return { probability: 1, hits: iters, iterations: iters, seen };
    if (!n || totalWanted > n) return { probability: 0, hits: 0, iterations: iters, seen };

    const rng = mulberry32(Number.isFinite(Number(seed)) ? Number(seed) : (Date.now() & 0xffffffff));
    const keepReqs = normReqs(keep);
    const keepUnits = keepReqs.reduce((s, w) => s + w.n, 0);
    const free = g.freeMulligan ? 1 : 0;
    // Oltre h7 + free mulligan la mano è già vuota: altri giri non cambiano niente.
    const maxMull = keepReqs.length ? Math.min(countOf(mulligans), h7 + free) : 0;
    const idx = lib.map((_, i) => i);
    // Fisher-Yates parziale: riempie [from, to) pescando a caso fra [from, end).
    const shuffleRange = (from, to, end) => {
      for (let i = from; i < Math.min(to, end - 1); i++) {
        const j = i + Math.floor(rng() * (end - i));
        const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      }
    };
    const handAt = (from, to) => {
      const out = [];
      for (let i = from; i < to; i++) out.push(lib[idx[i]]);
      return out;
    };
    let hits = 0;

    for (let it = 0; it < iters; it++) {
      // Ogni mulligan rimescola la mano e ripesca 7 carte; quante andranno in
      // fondo si decide solo sulla mano tenuta.
      shuffleRange(0, h7, n);
      let taken = 0;
      let bottom = 0;
      while (maxMull > 0) {
        bottom = Math.min(h7, Math.max(0, taken - free));
        if (keepUnits <= h7 - bottom && handSatisfies(handAt(0, h7), keepReqs)) break;
        if (taken >= maxMull) break;
        taken++;
        shuffleRange(0, h7, n);
      }

      // Mano tenuta in [0, h), libreria in [h, end), carte messe in fondo in
      // [end, n): le pescate escono dalla libreria e arrivano al fondo per ultime.
      let h = h7;
      let end = n;
      if (bottom > 0) {
        const kept = keptAfterBottom(handAt(0, h7), bottom, keepReqs, reqs);
        const keptSet = new Set(kept);
        const handIdx = kept.map((i) => idx[i]);
        const botIdx = [];
        for (let i = 0; i < h7; i++) if (!keptSet.has(i)) botIdx.push(idx[i]);
        h = handIdx.length;
        end = n - botIdx.length;
        for (let k = 0; k < n - h7; k++) idx[h + k] = idx[h7 + k];
        for (let k = 0; k < h; k++) idx[k] = handIdx[k];
        for (let k = 0; k < botIdx.length; k++) idx[end + k] = botIdx[k];
      }

      const total = Math.min(n, h + laterDraws);
      shuffleRange(h, total, end);
      const drawn = [];
      for (let i = 0; i < total; i++) {
        const tags = lib[idx[i]];
        if (tags.length) drawn.push(tags); // le carte senza tag non coprono nulla
      }
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
    keptAfterBottom,
    gameOf,
    DEFAULT_KEEP,
    describeConditions,
    simulate,
    // Mani per lotto della stima progressiva (~15k = pochi ms): riquadro e chat
    // lanciano gli stessi lotti con gli stessi seed, così danno lo stesso numero.
    PROB_BATCH: 15000,
    _mulberry32: mulberry32,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
