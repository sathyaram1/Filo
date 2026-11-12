// Substrato dati per la credibilità di chi vota (DC5): struttura, campi grezzi e gate
// pass-through, SENZA calcolo né policy. Tarare le soglie senza dati reali farebbe danno,
// quindi la credibilità è sempre 1 e il gate lascia passare tutti. Store: del chiamante.

(function (global) {
  'use strict';

  // Peso di un voto in assenza di storico: 1 = neutro, nessun peso extra e nessuna
  // penalità. Stesso default di normalizeCredibility() in feedback.js.
  const DEFAULT_CREDIBILITY = 1;

  // Soglia del gate canEarnFromVote: 0 = passano tutti. Alzarla attiva il gating.
  const EARN_GATE_THRESHOLD = 0;

  // `store` = { [uid]: { credibility, firstSeenAt, voteCount, … } }. Uid mancante o
  // valore non finito ≥ 0 → DEFAULT.
  function getCredibility(uid, store) {
    if (!uid || !store || typeof store !== 'object') return DEFAULT_CREDIBILITY;
    const entry = store[uid];
    if (!entry || typeof entry !== 'object') return DEFAULT_CREDIBILITY;
    const c = Number(entry.credibility);
    return Number.isFinite(c) && c >= 0 ? c : DEFAULT_CREDIBILITY;
  }

  // `firstSeenAt`: ISO del primo contatto col sistema.
  function freshEntry(uid, { firstSeenAt = new Date().toISOString() } = {}) {
    return {
      uid: String(uid || ''),
      credibility: DEFAULT_CREDIBILITY,
      firstSeenAt,
      // Campi grezzi per il futuro algoritmo:
      voteCount: 0,
      matchCount: 0,       // quante volte il voto coincideva con la decisione finale
      missCount: 0,        // quante volte il voto era opposto alla decisione finale
      lastVoteAt: null,    // ISO string dell'ultimo voto espresso
      outcomes: [],        // array di { feedbackId, vote, outcome, at } — ultimi N
    };
  }

  // I campi minimi per ricostruire la storia e calcolare l'accuratezza in futuro.
  // `vote` lo valida il chiamante, qui non si duplica.
  function makeVoteRecord({ uid, feedbackId, vote, at = new Date().toISOString() } = {}) {
    return {
      uid: String(uid || ''),
      feedbackId: String(feedbackId || ''),
      vote: String(vote || ''),
      at: String(at),
    };
  }

  // Aggiorna i grezzi confrontando il voto con l'esito con cui il feedback si è chiuso.
  // NON ricalcola `credibility`: la policy è rimandata. PURA: ritorna la nuova entry.
  function recordVoteOutcome(entry, { feedbackId, vote, finalOutcome, at = new Date().toISOString() } = {}) {
    if (!entry || typeof entry !== 'object') return freshEntry('');
    const e = Object.assign({}, entry);
    e.outcomes = Array.isArray(e.outcomes) ? e.outcomes.slice() : [];

    const matched = String(vote) === String(finalOutcome);
    e.matchCount = (Number(e.matchCount) || 0) + (matched ? 1 : 0);
    e.missCount  = (Number(e.missCount)  || 0) + (matched ? 0 : 1);

    // Solo gli ultimi 50 esiti (anti-bloat): bastano al futuro algoritmo.
    e.outcomes.push({ feedbackId: String(feedbackId || ''), vote: String(vote || ''), finalOutcome: String(finalOutcome || ''), at: String(at) });
    if (e.outcomes.length > 50) e.outcomes = e.outcomes.slice(-50);

    return e;
  }

  // PURA, non muta l'input. Da chiamare DOPO castVote.
  function recordVoteCast(entry, { at = new Date().toISOString() } = {}) {
    if (!entry || typeof entry !== 'object') return freshEntry('');
    const e = Object.assign({}, entry);
    e.voteCount = (Number(e.voteCount) || 0) + 1;
    e.lastVoteAt = String(at);
    return e;
  }

  // Oggi SEMPRE true (soglia 0). `opts.threshold` la sovrascrive e `opts.flagEnabled`
  // false forza il pass-through: è qui che si accenderà il gating.
  function canEarnFromVote(credibility, opts) {
    const o = opts || {};
    if (!o.flagEnabled) return true;
    const threshold = Number(o.threshold != null ? o.threshold : EARN_GATE_THRESHOLD);
    const c = Number.isFinite(Number(credibility)) ? Number(credibility) : DEFAULT_CREDIBILITY;
    return c >= threshold;
  }

  global.SN_USER_CREDIBILITY = {
    DEFAULT_CREDIBILITY,
    EARN_GATE_THRESHOLD,
    getCredibility,
    freshEntry,
    makeVoteRecord,
    recordVoteOutcome,
    recordVoteCast,
    canEarnFromVote,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
