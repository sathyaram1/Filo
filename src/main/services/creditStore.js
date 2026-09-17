// Motore crediti: 1 credito = €0,0008. Logica pura più cache locale.
// Il costo € reale resta dietro le quinte, mai mostrato all'utente.
// La sincronizzazione su Firestore vive in handlers/credits.js (serialize/adopt/onChange).

(function (global) {
  'use strict';

  const { STORAGE_KEYS, CREDIT, creditUsageGroup } = global.SN_CONST;

  // Date in ora LOCALE: l'utente pensa alla SUA mezzanotte.

  function dateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Calcolo a mezzogiorno UTC per evitare le derive di fuso e ora legale.
  function daysBetween(fromKey, toKey) {
    if (!fromKey || !toKey) return 0;
    const a = Date.parse(`${fromKey}T12:00:00Z`);
    const b = Date.parse(`${toKey}T12:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
  }

  function freshState(today = dateKey()) {
    return {
      initialized: true,
      balance: CREDIT.INITIAL,
      lastRefillDate: today,
      byUsage: {},        // { [gruppo]: { credits, calls } }  — per la torta
      byAction: {},       // { [action]: { credits, costEur, calls } } — dettaglio (costEur dietro le quinte)
      totalSpentCredits: 0,
      totalCostEur: 0,    // dietro le quinte
      rewards: [],        // [{ ts, kind, credits, ref }]
      rewardedFeedback: {},// { [feedbackId]: true } — anti doppio premio risoluzione (C5)
      // Namespace SEPARATO da rewardedFeedback: risoluzione (C5) e voto in bacheca (DC2) sono
      // due eventi distinti e non devono bloccarsi a vicenda.
      rewardedVotes: {},  // { [feedbackId]: true }
      owner: null,        // uid/email a cui appartiene questa cache (switch account)
      // Data dell'ultimo bonus giornaliero "feedback autonomo attivo" (F4); '' = mai ricevuto.
      lastAutoFeedbackBonusDate: '',
    };
  }

  function ensure(state) {
    const s = state && state.initialized ? state : freshState();
    if (!s.byUsage) s.byUsage = {};
    if (!s.byAction) s.byAction = {};
    if (!Array.isArray(s.rewards)) s.rewards = [];
    if (!s.rewardedFeedback) s.rewardedFeedback = {};
    if (!s.rewardedVotes) s.rewardedVotes = {};
    if (typeof s.balance !== 'number') s.balance = CREDIT.INITIAL;
    if (!s.lastRefillDate) s.lastRefillDate = dateKey();
    if (typeof s.lastAutoFeedbackBonusDate !== 'string') s.lastAutoFeedbackBonusDate = '';
    return s;
  }

  // Una ricarica per ogni mezzanotte passata, al massimo MAX_REFILL_DAYS: il tetto è l'argine
  // a un orologio spostato indietro.
  function applyRefill(state, today = dateKey(), autoFeedbackEnabled = false) {
    const s = ensure(state);
    const missed = daysBetween(s.lastRefillDate, today);
    let added = 0;
    if (missed > 0) {
      const days = Math.min(missed, CREDIT.MAX_REFILL_DAYS);
      added = days * CREDIT.DAILY_REFILL;
      s.balance += added;
      s.lastRefillDate = today;
    }
    const AF = global.SN_AUTO_FEEDBACK;
    let bonusAdded = 0;
    if (AF && typeof AF.applyAutoFeedbackBonus === 'function') {
      const { bonusAdded: b } = AF.applyAutoFeedbackBonus(s, today, autoFeedbackEnabled);
      bonusAdded = b;
    }
    return { state: s, added, bonusAdded };
  }

  function costEurToCredits(costEur) {
    if (!costEur || costEur <= 0) return 0;
    return costEur / CREDIT.EUR_PER_CREDIT;
  }

  // Priorità mancante o fuori scala → fascia 0 (C5).
  function rewardForPriority(priority) {
    const table = CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY || {};
    const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
    return Number(table[p]) || Number(table[0]) || 0;
  }

  // Il saldo non scende sotto 0.
  function applyConsumption(state, { action, costEur = 0, calls = 1 }) {
    const s = ensure(state);
    const credits = costEurToCredits(costEur);
    s.balance = Math.max(0, s.balance - credits);
    s.totalSpentCredits += credits;
    s.totalCostEur += (costEur || 0);

    const group = creditUsageGroup(action);
    const g = s.byUsage[group] || { credits: 0, calls: 0 };
    g.credits += credits;
    g.calls += calls;
    s.byUsage[group] = g;

    const a = s.byAction[action] || { credits: 0, costEur: 0, calls: 0 };
    a.credits += credits;
    a.costEur += (costEur || 0);
    a.calls += calls;
    s.byAction[action] = a;

    return { state: s, credits };
  }

  function applyAward(state, { kind, credits = 0, ref = null, ts = Date.now() }) {
    const s = ensure(state);
    const amount = Math.max(0, Number(credits) || 0);
    s.balance += amount;
    s.rewards.push({ ts, kind, credits: amount, ref });
    if (kind === 'feedback_resolved' && ref) s.rewardedFeedback[ref] = true;
    if (kind === 'feedback_voted' && ref) s.rewardedVotes[ref] = true;
    return { state: s, credits: amount };
  }

  // Tiene awardVoteOnce idempotente a chiamate ripetute: cambio voto, doppio click, retry
  // di rete. Pura: decide senza I/O.
  function isVoteRewardPending(state, feedbackId) {
    const s = ensure(state);
    return !!feedbackId && !s.rewardedVotes[feedbackId];
  }

  // Spesa anti-spam (DC4): costo NOTO pagato dall'utente, quindi o scala esattamente amount o
  // rifiuta col saldo intoccato. applyConsumption invece clampa a 0, lì il costo è nascosto.
  function applyConsumptionIfAffordable(state, amount) {
    const s = ensure(state);
    const cost = Math.max(0, Number(amount) || 0);
    if (s.balance < cost) {
      return { state: s, ok: false, balance: Math.round(s.balance) };
    }
    s.balance -= cost;
    return { state: s, ok: true, balance: Math.round(s.balance) };
  }

  // Vista pubblica per la UI: nessun costo €, né totale né per-azione.
  function publicView(state) {
    const s = ensure(state);
    const byUsage = {};
    for (const [group, v] of Object.entries(s.byUsage)) {
      byUsage[group] = { credits: round1(v.credits), calls: v.calls };
    }
    return {
      balance: Math.round(s.balance),
      balanceExact: s.balance,
      lastRefillDate: s.lastRefillDate,
      byUsage,
      totalSpentCredits: round1(s.totalSpentCredits),
      rewards: s.rewards.slice(-50),
    };
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  const listeners = new Set();
  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function emitChange(state, reason) {
    for (const cb of listeners) { try { cb(state, reason); } catch (_) {} }
  }

  async function readState() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.CREDITS);
    return ensure(res[STORAGE_KEYS.CREDITS]);
  }
  async function writeState(state) {
    await chrome.storage.local.set({ [STORAGE_KEYS.CREDITS]: state });
  }

  // Persiste solo se lo stato è cambiato (refill o prima inizializzazione) e notifica solo se
  // ha accreditato.
  async function load({ autoFeedbackEnabled = false } = {}) {
    const raw = await chrome.storage.local.get(STORAGE_KEYS.CREDITS);
    const had = !!raw[STORAGE_KEYS.CREDITS];
    const { state, added, bonusAdded } = applyRefill(ensure(raw[STORAGE_KEYS.CREDITS]), dateKey(), autoFeedbackEnabled);
    const changed = !had || added > 0 || bonusAdded > 0;
    if (changed) {
      await writeState(state);
      if (added > 0 || bonusAdded > 0) emitChange(state, 'refill');
    }
    return state;
  }

  async function getPublic() {
    return publicView(await load());
  }

  async function recordConsumption({ action, costEur = 0, provider, model, usage } = {}) {
    const state = await load();
    const { credits } = applyConsumption(state, { action, costEur });
    await writeState(state);
    if (credits > 0) emitChange(state, 'consumption');
    return credits;
  }

  async function award({ kind, credits, ref } = {}) {
    const state = await load();
    const { credits: amount } = applyAward(state, { kind, credits, ref });
    await writeState(state);
    emitChange(state, 'award');
    return { credits: amount, balance: Math.round(state.balance) };
  }

  async function wasFeedbackRewarded(id) {
    const state = await load();
    return !!state.rewardedFeedback[id];
  }

  // La cache crediti è già per-account (vedi ensureAccountSync nell'handler).
  async function wasVoteRewarded(id) {
    const state = await load();
    return !!state.rewardedVotes[id];
  }

  // Un premio voto per feedback per utente (DC2): cambiare idea o rivotare non riaccredita.
  async function awardVoteOnce(feedbackId, amount) {
    const state = await load();
    if (!isVoteRewardPending(state, feedbackId)) {
      return { credits: 0, balance: Math.round(state.balance), awarded: false };
    }
    const { credits } = applyAward(state, { kind: 'feedback_voted', credits: amount, ref: feedbackId });
    await writeState(state);
    emitChange(state, 'award');
    return { credits, balance: Math.round(state.balance), awarded: true };
  }

  // La spesa è un award negativo così compare nello storico accanto alle ricompense.
  // Se il saldo non basta non scrive nulla: un tentativo respinto non costa crediti.
  async function spendIfAffordable(amount, { kind = 'spend', ref = null } = {}) {
    const state = await load();
    const { ok, balance } = applyConsumptionIfAffordable(state, amount);
    if (!ok) return { ok: false, balance };
    state.rewards.push({ ts: Date.now(), kind, credits: -Math.abs(Number(amount) || 0), ref });
    await writeState(state);
    emitChange(state, 'spend');
    return { ok: true, balance };
  }

  // Sostituisce lo stato locale con quello di Firestore per owner (cambio account o login).
  async function adopt(remoteState, owner) {
    const { state } = applyRefill(ensure(remoteState), dateKey());
    state.owner = owner || null;
    await writeState(state);
    emitChange(state, 'adopt');
    return state;
  }

  async function setOwner(owner) {
    const state = await load();
    if (state.owner !== owner) {
      state.owner = owner || null;
      await writeState(state);
    }
    return state;
  }

  global.SN_CREDITS = {
    freshState, ensure, applyRefill, costEurToCredits, rewardForPriority,
    applyConsumption, applyAward, isVoteRewardPending, applyConsumptionIfAffordable,
    publicView, dateKey, daysBetween,
    load, getPublic, recordConsumption, award, wasFeedbackRewarded,
    wasVoteRewarded, awardVoteOnce, spendIfAffordable,
    readState, writeState, adopt, setOwner, onChange,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
