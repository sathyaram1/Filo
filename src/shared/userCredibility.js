// Substrato dati credibilità per utente (DC5).
//
// Fornisce il SUBSTRATO — struttura dati, campi grezzi, gate pass-through —
// senza calcolo dinamico né policy. Il calcolo della credibilità dal comportamento
// storico è volutamente RIMANDATO: senza dati reali su cui tarare le soglie,
// un algoritmo inventato farebbe più danno che bene.
//
// Cosa sta qui:
//   - DEFAULT_CREDIBILITY = 1 (peso di un voto quando il substrato è vuoto).
//   - makeVoteRecord: costruisce il record grezzo da salvare al momento del voto
//     (timestamp, feedbackId, uid), il pezzo "mancante" per ricostruire la storia.
//   - recordVoteOutcome: segnala l'esito di un voto (il fix era works/broken e la
//     decisione finale ha confermato o meno il voto) — campo grezzo per il futuro.
//   - getCredibility: legge la credibilità di un utente da uno store in memoria.
//     Oggi ritorna sempre DEFAULT_CREDIBILITY=1 se non c'è entry (pass-through).
//   - canEarnFromVote: gate "l'utente può guadagnare crediti da questo voto?"
//     Oggi SEMPRE true (flag spento, soglia = 0 → qualunque credibilità passa).
//     È il punto futuro di gating: quando si avrà un algoritmo, si alza la soglia.
//
// Architettura: logica PURA, niente I/O, niente chrome.storage/Firestore.
// Il chiamante (handler voti, routine cloud) mantiene e persiste lo store.
// Testabile headless via `npm run test:unit`.
//
// Pattern IIFE su globalThis: vedi CLAUDE.md → "Convenzione di porting".

(function (global) {
  'use strict';

  // ── costanti ────────────────────────────────────────────────────────────────

  // Peso di un voto in assenza di storico. Valore 1 = "neutro" (nessun peso
  // extra, nessuna penalità). Corrisponde a normalizeCredibility() in feedback.js
  // che usa lo stesso default.
  const DEFAULT_CREDIBILITY = 1;

  // Soglia minima di credibilità per il gate canEarnFromVote (flag spento = 0 →
  // tutti passano). Alzare questa costante in futuro attiva il gating.
  const EARN_GATE_THRESHOLD = 0;

  // ── funzioni PURE ────────────────────────────────────────────────────────────

  // Legge la credibilità di un utente dallo store in memoria.
  // `store` = { [uid]: { credibility, firstSeenAt, voteCount, ... } }.
  // Se l'uid manca o il valore non è un numero finito ≥ 0, ritorna DEFAULT.
  function getCredibility(uid, store) {
    if (!uid || !store || typeof store !== 'object') return DEFAULT_CREDIBILITY;
    const entry = store[uid];
    if (!entry || typeof entry !== 'object') return DEFAULT_CREDIBILITY;
    const c = Number(entry.credibility);
    return Number.isFinite(c) && c >= 0 ? c : DEFAULT_CREDIBILITY;
  }

  // Crea un'entry vuota per un nuovo utente (primo voto mai ricevuto).
  // `firstSeenAt`: ISO string del momento del primo contatto con il sistema.
  function freshEntry(uid, { firstSeenAt = new Date().toISOString() } = {}) {
    return {
      uid: String(uid || ''),
      credibility: DEFAULT_CREDIBILITY,
      firstSeenAt,
      // Campi grezzi per il futuro algoritmo:
      voteCount: 0,        // quanti voti ha espresso in totale
      matchCount: 0,       // quante volte il voto coincideva con la decisione finale
      missCount: 0,        // quante volte il voto era opposto alla decisione finale
      lastVoteAt: null,    // ISO string dell'ultimo voto espresso
      outcomes: [],        // array di { feedbackId, vote, outcome, at } — ultimi N
    };
  }

  // Costruisce il record grezzo da allegare a un voto al momento del cast.
  // Ritorna { uid, feedbackId, vote, at } — i campi minimi per ricostruire la
  // storia e calcolare l'accuratezza in futuro.
  // `vote` = 'works' | 'broken' (validato dal chiamante, non duplicato qui).
  function makeVoteRecord({ uid, feedbackId, vote, at = new Date().toISOString() } = {}) {
    return {
      uid: String(uid || ''),
      feedbackId: String(feedbackId || ''),
      vote: String(vote || ''),
      at: String(at),
    };
  }

  // Segnala l'esito di un voto: il feedback si è chiuso come `finalOutcome`
  // ('works' | 'broken'), il voto dell'utente era `vote`. Aggiorna i campi
  // grezzi matchCount/missCount/outcomes nell'entry dell'utente.
  // NOTA: NON ricalcola `credibility` (la policy è rimandato). Il chiamante
  // può chiamare questa funzione quando un feedback passa a `done`/`archived`
  // per tenere i grezzi aggiornati, anche se la credibilità non cambia ancora.
  // Ritorna la nuova entry (PURA: non muta l'input).
  function recordVoteOutcome(entry, { feedbackId, vote, finalOutcome, at = new Date().toISOString() } = {}) {
    if (!entry || typeof entry !== 'object') return freshEntry('');
    const e = Object.assign({}, entry);
    e.outcomes = Array.isArray(e.outcomes) ? e.outcomes.slice() : [];

    const matched = String(vote) === String(finalOutcome);
    e.matchCount = (Number(e.matchCount) || 0) + (matched ? 1 : 0);
    e.missCount  = (Number(e.missCount)  || 0) + (matched ? 0 : 1);

    // Teniamo solo gli ultimi 50 esiti (anti-bloat). Basta per il futuro algoritmo.
    e.outcomes.push({ feedbackId: String(feedbackId || ''), vote: String(vote || ''), finalOutcome: String(finalOutcome || ''), at: String(at) });
    if (e.outcomes.length > 50) e.outcomes = e.outcomes.slice(-50);

    // credibility invariata: la policy di aggiornamento non è ancora definita.
    return e;
  }

  // Aggiorna i contatori "voto espresso" nell'entry: incrementa voteCount e
  // aggiorna lastVoteAt. PURA, non muta l'input. Da chiamare DOPO castVote.
  function recordVoteCast(entry, { at = new Date().toISOString() } = {}) {
    if (!entry || typeof entry !== 'object') return freshEntry('');
    const e = Object.assign({}, entry);
    e.voteCount = (Number(e.voteCount) || 0) + 1;
    e.lastVoteAt = String(at);
    return e;
  }

  // Gate "l'utente può guadagnare crediti da questo voto?".
  // Oggi SEMPRE true (flag spento: EARN_GATE_THRESHOLD = 0).
  // Quando si alzerà la soglia, basterà cambiare EARN_GATE_THRESHOLD oppure
  // passare { threshold } nelle opts. Punto futuro di gating.
  //
  // `credibility` (number): la credibilità dell'utente (da getCredibility).
  // `opts.threshold` (number, opzionale): soglia minima; se non passa usa EARN_GATE_THRESHOLD.
  // `opts.flagEnabled` (bool, opzionale): se false forza pass-through (flag spento).
  // Ritorna true se l'utente può guadagnare crediti, false altrimenti.
  function canEarnFromVote(credibility, opts) {
    const o = opts || {};
    // Flag spento = pass-through (default oggi).
    if (!o.flagEnabled) return true;
    const threshold = Number(o.threshold != null ? o.threshold : EARN_GATE_THRESHOLD);
    const c = Number.isFinite(Number(credibility)) ? Number(credibility) : DEFAULT_CREDIBILITY;
    return c >= threshold;
  }

  // ── export ───────────────────────────────────────────────────────────────────

  global.SN_USER_CREDIBILITY = {
    DEFAULT_CREDIBILITY,
    EARN_GATE_THRESHOLD,
    // Funzioni pure (substrato dati).
    getCredibility,
    freshEntry,
    makeVoteRecord,
    recordVoteOutcome,
    recordVoteCast,
    // Gate pass-through (punto futuro di policy).
    canEarnFromVote,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
