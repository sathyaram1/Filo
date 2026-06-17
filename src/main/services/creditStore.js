// Motore crediti (gamification). 1 credito = 0,08 centesimi di € (€0,0008).
//
// - Saldo iniziale 1000, +100 ogni mezzanotte LOCALE (refill lazy: al primo
//   accesso del giorno accredita i giorni mancanti, con un tetto anti-abuso).
// - Ogni chiamata AI consuma crediti = costo€/0,0008. Il costo € reale resta
//   DIETRO LE QUINTE (tracciato con precisione, mai mostrato all'utente):
//   `recordConsumption` viene chiamato da costTracker.record dopo aver calcolato
//   l'EUR, così TUTTI i call site esistenti sono coperti senza ritoccarli.
// - Aggrega il consumo per "tipo d'uso" (correttore, riordino schede, chat…)
//   per il grafico a torta della pagina Crediti.
// - Ricompense feedback (+5 all'invio, variabile alla risoluzione) via `award`.
//
// Architettura: questo modulo è LOGICA PURA + cache locale (chrome.storage.local),
// come costTracker — testabile headless. La sincronizzazione su Firestore
// (doc `credits/<uid>` per-account) vive nell'handler `handlers/credits.js`, che
// usa serialize()/adopt() e si iscrive a onChange() per il push.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, CREDIT, creditUsageGroup } = global.SN_CONST;

  // ── helper data/tempo (LOCALE: l'utente pensa alla SUA mezzanotte) ──────────

  function dateKey(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Giorni interi tra due chiavi 'YYYY-MM-DD' (toKey - fromKey). >0 se toKey
  // è successivo. Calcolato a mezzogiorno UTC per evitare derive di fuso/DST.
  function daysBetween(fromKey, toKey) {
    if (!fromKey || !toKey) return 0;
    const a = Date.parse(`${fromKey}T12:00:00Z`);
    const b = Date.parse(`${toKey}T12:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
  }

  // ── stato + funzioni PURE (nessuna I/O: testabili headless) ─────────────────

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
      rewardedFeedback: {},// { [feedbackId]: true } — anti doppio premio (C5)
      owner: null,        // uid/email a cui appartiene questa cache (switch account)
    };
  }

  function ensure(state) {
    const s = state && state.initialized ? state : freshState();
    if (!s.byUsage) s.byUsage = {};
    if (!s.byAction) s.byAction = {};
    if (!Array.isArray(s.rewards)) s.rewards = [];
    if (!s.rewardedFeedback) s.rewardedFeedback = {};
    if (typeof s.balance !== 'number') s.balance = CREDIT.INITIAL;
    if (!s.lastRefillDate) s.lastRefillDate = dateKey();
    return s;
  }

  // Accredita +DAILY_REFILL per ogni mezzanotte passata da lastRefillDate,
  // fino a MAX_REFILL_DAYS. Ritorna { state, added }.
  function applyRefill(state, today = dateKey()) {
    const s = ensure(state);
    const missed = daysBetween(s.lastRefillDate, today);
    if (missed <= 0) return { state: s, added: 0 };
    const days = Math.min(missed, CREDIT.MAX_REFILL_DAYS);
    const added = days * CREDIT.DAILY_REFILL;
    s.balance += added;
    s.lastRefillDate = today;
    return { state: s, added };
  }

  function costEurToCredits(costEur) {
    if (!costEur || costEur <= 0) return 0;
    return costEur / CREDIT.EUR_PER_CREDIT;
  }

  // Ricompensa (crediti) per la RISOLUZIONE di un feedback in base alla priorità
  // dell'utente (0-3). Priorità mancante/fuori scala → fascia 0. (C5)
  function rewardForPriority(priority) {
    const table = CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY || {};
    const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
    return Number(table[p]) || Number(table[0]) || 0;
  }

  // Sottrae i crediti corrispondenti al costo € e aggrega per uso. Il saldo non
  // scende sotto 0. Ritorna { state, credits }.
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

  // Accredita una ricompensa (feedback inviato/risolto). Ritorna { state, credits }.
  function applyAward(state, { kind, credits = 0, ref = null, ts = Date.now() }) {
    const s = ensure(state);
    const amount = Math.max(0, Number(credits) || 0);
    s.balance += amount;
    s.rewards.push({ ts, kind, credits: amount, ref });
    if (kind === 'feedback_resolved' && ref) s.rewardedFeedback[ref] = true;
    return { state: s, credits: amount };
  }

  // Vista PUBBLICA per la UI: niente costo € (né totale né per-azione). Solo
  // saldo + consumo per tipo d'uso (per la torta) + ricompense.
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

  // ── wrapper ASYNC con persistenza + notifica onChange ───────────────────────

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

  // Carica lo stato applicando il refill mezzanotte. Persiste solo se è cambiato
  // (refill applicato o prima inizializzazione). Notifica se ha accreditato.
  async function load() {
    const raw = await chrome.storage.local.get(STORAGE_KEYS.CREDITS);
    const had = !!raw[STORAGE_KEYS.CREDITS];
    const { state, added } = applyRefill(ensure(raw[STORAGE_KEYS.CREDITS]), dateKey());
    if (!had || added > 0) {
      await writeState(state);
      if (added > 0) emitChange(state, 'refill');
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

  // True se quel feedback ha già ricevuto la ricompensa di risoluzione (C5).
  async function wasFeedbackRewarded(id) {
    const state = await load();
    return !!state.rewardedFeedback[id];
  }

  // ── sincronizzazione (usate da handlers/credits.js) ─────────────────────────

  // Sostituisce lo stato locale con quello adottato da Firestore per `owner`
  // (cambio account / primo login). Applica subito il refill sul remoto.
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
    // pure (per i test e la logica)
    freshState, ensure, applyRefill, costEurToCredits, applyConsumption,
    applyAward, publicView, dateKey, daysBetween,
    // async (runtime)
    load, getPublic, recordConsumption, award, wasFeedbackRewarded,
    readState, writeState, adopt, setOwner, onChange,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
