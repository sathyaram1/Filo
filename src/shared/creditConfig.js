// Config CREDITI configurabile dall'owner (backend, #366.2).
//
// Gli importi crediti (saldo iniziale, ricarica giornaliera, premi feedback,
// voto/riapertura bacheca, tetto ricarica) sono normalmente le costanti CREDIT
// in constants.js. L'owner puo' pero' sovrascriverli GLOBALMENTE — per TUTTI gli
// utenti, senza rilasciare una nuova versione — tramite il doc Firestore
// `config/credits`. Questo modulo e' logica PURA (testabile headless):
//   - `defaults()`  → la config di default, ESATTAMENTE = costanti CREDIT correnti;
//   - `normalize(raw)` → prende un doc grezzo (letto da Firestore) e ne ricava
//     una config COMPLETA e SICURA: ogni campo valido sovrascrive il default,
//     ogni campo mancante/invalido/negativo ricade sul default CREDIT.
//
// Le costanti CREDIT restano l'unica fonte dei DEFAULT (fallback): se la config
// remota e' assente (offline / non ancora scritta) o parziale, il comportamento
// e' identico a oggi. Il motore crediti (SN_CREDITS) legge questi importi come
// PARAMETRI; la sorgente remota + cache vive in defaultsStore.js.

(function (global) {
  'use strict';

  function CREDIT() {
    return (global.SN_CONST && global.SN_CONST.CREDIT) || {};
  }

  // Numero valido e non negativo, altrimenti il fallback. (Gli importi crediti
  // non hanno mai senso negativi; un valore sballato nel doc non deve rompere
  // il motore ne' azzerare i premi.)
  function num(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  // La config di DEFAULT = le costanti CREDIT correnti (nessun cambio di
  // comportamento finche' l'owner non modifica).
  function defaults() {
    const K = CREDIT();
    return {
      initial: num(K.INITIAL, 1000),
      dailyRefill: num(K.DAILY_REFILL, 100),
      maxRefillDays: num(K.MAX_REFILL_DAYS, 30),
      feedbackSend: num(K.FEEDBACK_SEND, 5),
      feedbackResolveByPriority: normalizeTable(K.FEEDBACK_RESOLVE_BY_PRIORITY, null),
      boardVote: num(K.BOARD_VOTE, 10),
      boardReopen: num(K.BOARD_REOPEN, 5),
    };
  }

  // Tabella premi risoluzione per priorita' 0..3. `raw` sovrascrive `base`
  // campo per campo; ogni fascia mancante/invalida ricade su `base` (o, se
  // base e' null, sui default storici 50/100/200/300).
  function normalizeTable(raw, base) {
    const HIST = { 0: 50, 1: 100, 2: 200, 3: 300 };
    const b = base || {};
    const out = {};
    for (const p of [0, 1, 2, 3]) {
      const fallback = num(b[p], HIST[p]);
      out[p] = raw && typeof raw === 'object' ? num(raw[p], fallback) : fallback;
    }
    return out;
  }

  // Da doc grezzo Firestore → config completa e sicura. `raw` puo' essere:
  //   - null/undefined/non-oggetto  → tutti i default;
  //   - parziale                    → i campi presenti e validi vincono, il resto default;
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

  global.SN_CREDIT_CONFIG = { defaults, normalize, normalizeTable };
})(typeof globalThis !== 'undefined' ? globalThis : self);
