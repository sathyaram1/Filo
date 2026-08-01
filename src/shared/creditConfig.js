// Config CREDITI configurabile dall'owner (backend, #366.2).
//
// Gli importi crediti (saldo iniziale, ricarica giornaliera, premi feedback,
// voto/riapertura bacheca, tetto ricarica) sono normalmente le costanti CREDIT
// in constants.js. L'owner può però sovrascriverli GLOBALMENTE — per TUTTI gli
// utenti, senza rilasciare una nuova versione — tramite il doc Firestore
// `config/credits`. Questo modulo è logica PURA (testabile headless):
//   - `defaults()`     → la config di default, ESATTAMENTE = costanti CREDIT correnti;
//   - `normalize(raw)` → prende un doc grezzo (letto da Firestore) e ne ricava
//     una config COMPLETA e SICURA: ogni campo valido sovrascrive il default,
//     ogni campo mancante/invalido/negativo ricade sul default CREDIT.
//
// Le costanti CREDIT restano l'unica fonte dei DEFAULT (fallback): se la config
// remota è assente (offline / non ancora scritta) o parziale, il comportamento è
// identico a prima di #366.2. Il motore crediti (SN_CREDITS) legge questi importi
// come PARAMETRI; la sorgente remota + cache vive in defaultsStore.js.
//
// NB: il costo EUR (CREDIT.EUR_PER_CREDIT) NON è configurabile e non compare
// qui: resta dietro le quinte, com'è sempre stato.

(function (global) {
  'use strict';

  // Default STORICI, usati solo se le costanti non sono caricate (contesto
  // isolato/test): la config non deve mai collassare a 0 per un ordine di
  // caricamento sbagliato.
  const HIST = {
    initial: 1000,
    dailyRefill: 100,
    maxRefillDays: 30,
    feedbackSend: 5,
    resolveByPriority: { 0: 50, 1: 100, 2: 200, 3: 300 },
    boardVote: 10,
    boardReopen: 5,
  };

  function CREDIT() {
    return (global.SN_CONST && global.SN_CONST.CREDIT) || {};
  }

  // Numero valido e non negativo, altrimenti il fallback. (Gli importi crediti
  // non hanno mai senso negativi; un valore sballato nel doc non deve rompere il
  // motore né azzerare i premi.)
  function num(v, fallback) {
    // null/undefined/'' = campo assente → fallback. Uno 0 ESPLICITO resta 0
    // (importo valido: l'owner può disattivare un premio). Number(null) sarebbe
    // 0: lo escludiamo prima, altrimenti un campo assente diventerebbe 0 invece
    // del default.
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  // Tabella premi risoluzione per priorità 0..3. `raw` sovrascrive `base` fascia
  // per fascia; ogni fascia mancante/invalida ricade su `base` (o, se base è
  // null/assente, sui default storici 50/100/200/300).
  function normalizeTable(raw, base) {
    const b = base || {};
    const out = {};
    for (const p of [0, 1, 2, 3]) {
      const fallback = num(b[p], HIST.resolveByPriority[p]);
      out[p] = raw && typeof raw === 'object' ? num(raw[p], fallback) : fallback;
    }
    return out;
  }

  // La config di DEFAULT = le costanti CREDIT correnti (nessun cambio di
  // comportamento finché l'owner non modifica nulla).
  function defaults() {
    const K = CREDIT();
    return {
      initial: num(K.INITIAL, HIST.initial),
      dailyRefill: num(K.DAILY_REFILL, HIST.dailyRefill),
      maxRefillDays: num(K.MAX_REFILL_DAYS, HIST.maxRefillDays),
      feedbackSend: num(K.FEEDBACK_SEND, HIST.feedbackSend),
      feedbackResolveByPriority: normalizeTable(K.FEEDBACK_RESOLVE_BY_PRIORITY, null),
      boardVote: num(K.BOARD_VOTE, HIST.boardVote),
      boardReopen: num(K.BOARD_REOPEN, HIST.boardReopen),
    };
  }

  // Da doc grezzo Firestore → config completa e sicura. `raw` può essere:
  //   - null/undefined/non-oggetto → tutti i default;
  //   - parziale                   → i campi presenti e validi vincono, il resto default;
  //   - con valori invalidi/negativi → quei campi ricadono sul default.
  function normalize(raw) {
    const d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    return {
      initial: num(raw.initial, d.initial),
      dailyRefill: num(raw.dailyRefill, d.dailyRefill),
      maxRefillDays: num(raw.maxRefillDays, d.maxRefillDays),
      feedbackSend: num(raw.feedbackSend, d.feedbackSend),
      feedbackResolveByPriority: normalizeTable(raw.feedbackResolveByPriority, d.feedbackResolveByPriority),
      boardVote: num(raw.boardVote, d.boardVote),
      boardReopen: num(raw.boardReopen, d.boardReopen),
    };
  }

  // Campi numerici semplici (senza la tabella per priorità): unica fonte della
  // lista, usata anche da defaultsStore per costruire la PATCH su Firestore.
  const NUM_KEYS = ['initial', 'dailyRefill', 'maxRefillDays', 'feedbackSend', 'boardVote', 'boardReopen'];

  global.SN_CREDIT_CONFIG = { defaults, normalize, normalizeTable, NUM_KEYS };
})(typeof globalThis !== 'undefined' ? globalThis : self);
