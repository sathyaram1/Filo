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

  // ── importi configurabili dall'owner (#366.2) ───────────────────────────────
  // Gli importi crediti possono essere sovrascritti GLOBALMENTE dall'owner (doc
  // Firestore `config/credits`). L'handler crediti legge la config remota e la
  // registra qui con setActiveConfig(); i wrapper async (load/award/…) la usano.
  // Le funzioni PURE accettano invece un `config` ESPLICITO come ultimo
  // parametro (per i test e per chi passa una config al volo). In assenza di
  // config — esplicita o attiva — si ricade sui default CREDIT: comportamento
  // identico a prima di #366.2 (offline, non loggato, doc mai scritto).
  let activeConfig = null;

  function setActiveConfig(cfg) {
    activeConfig = cfg && typeof cfg === 'object' ? config(cfg) : null;
  }
  function getActiveConfig() { return activeConfig; }

  // Config effettiva per una chiamata: `explicit` > config attiva (owner) >
  // costanti CREDIT. Ogni campo mancante/invalido ricade sul default, quindi
  // anche una config parziale o sporca è sicura (normalizzazione in
  // SN_CREDIT_CONFIG, logica pura condivisa).
  function config(explicit) {
    const raw = (explicit && typeof explicit === 'object') ? explicit : activeConfig;
    const CC = global.SN_CREDIT_CONFIG;
    if (CC && typeof CC.normalize === 'function') return CC.normalize(raw);
    // Ripiego difensivo se il modulo shared non è caricato (contesto isolato):
    // i default storici delle costanti, mai valori a zero.
    return {
      initial: CREDIT.INITIAL,
      dailyRefill: CREDIT.DAILY_REFILL,
      maxRefillDays: CREDIT.MAX_REFILL_DAYS,
      feedbackSend: CREDIT.FEEDBACK_SEND,
      feedbackResolveByPriority: { ...(CREDIT.FEEDBACK_RESOLVE_BY_PRIORITY || {}) },
      boardVote: CREDIT.BOARD_VOTE,
      boardReopen: CREDIT.BOARD_REOPEN,
    };
  }

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

  // `cfg` (opzionale): importi da usare al posto dei default CREDIT (#366.2).
  function freshState(today = dateKey(), cfg) {
    return {
      initialized: true,
      balance: config(cfg).initial,
      lastRefillDate: today,
      byUsage: {},        // { [gruppo]: { credits, calls } }  — per la torta
      byAction: {},       // { [action]: { credits, costEur, calls } } — dettaglio (costEur dietro le quinte)
      totalSpentCredits: 0,
      totalCostEur: 0,    // dietro le quinte
      rewards: [],        // [{ ts, kind, credits, ref }]
      rewardedFeedback: {},// { [feedbackId]: true } — anti doppio premio risoluzione (C5)
      // Anti doppio premio VOTO board (DC2): namespace SEPARATO da rewardedFeedback,
      // perché un feedback può essere sia "risolto" (premio C5) sia "votato in
      // bacheca" (premio DC2) — sono due eventi distinti che non devono bloccarsi
      // a vicenda. Una sola entry per feedback per utente (la cache è già per-uid).
      rewardedVotes: {},  // { [feedbackId]: true }
      owner: null,        // uid/email a cui appartiene questa cache (switch account)
      // F4: data dell'ultimo bonus giornaliero "feedback autonomo attivo".
      // Stringa 'YYYY-MM-DD'; '' = mai ricevuto.
      lastAutoFeedbackBonusDate: '',
    };
  }

  function ensure(state, cfg) {
    const s = state && state.initialized ? state : freshState(dateKey(), cfg);
    if (!s.byUsage) s.byUsage = {};
    if (!s.byAction) s.byAction = {};
    if (!Array.isArray(s.rewards)) s.rewards = [];
    if (!s.rewardedFeedback) s.rewardedFeedback = {};
    if (!s.rewardedVotes) s.rewardedVotes = {};
    if (typeof s.balance !== 'number') s.balance = config(cfg).initial;
    if (!s.lastRefillDate) s.lastRefillDate = dateKey();
    // F4: campo bonus auto-feedback (retrocompatibile).
    if (typeof s.lastAutoFeedbackBonusDate !== 'string') s.lastAutoFeedbackBonusDate = '';
    return s;
  }

  // Accredita la ricarica giornaliera per ogni mezzanotte passata da
  // lastRefillDate, fino al tetto di giorni accumulabili. Se autoFeedbackEnabled
  // è true, aggiunge anche il bonus giornaliero +10 (una sola volta al giorno,
  // idempotente). `cfg` (opzionale, #366.2): importi owner-configurabili.
  // Ritorna { state, added, bonusAdded }.
  function applyRefill(state, today = dateKey(), autoFeedbackEnabled = false, cfg) {
    const c = config(cfg);
    const s = ensure(state, cfg);
    const missed = daysBetween(s.lastRefillDate, today);
    let added = 0;
    if (missed > 0) {
      // I giorni NON ancora accreditati valgono l'importo CORRENTE: se l'owner
      // cambia la ricarica, il nuovo valore parte dalla prossima ricarica senza
      // ricalcolare nulla all'indietro (i giorni già accreditati restano quelli).
      const days = Math.min(missed, c.maxRefillDays);
      added = days * c.dailyRefill;
      s.balance += added;
      s.lastRefillDate = today;
    }
    // F4: bonus giornaliero auto-feedback (idempotente via lastAutoFeedbackBonusDate).
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

  // Accredita una ricompensa (feedback inviato/risolto/votato). Ritorna { state, credits }.
  function applyAward(state, { kind, credits = 0, ref = null, ts = Date.now() }) {
    const s = ensure(state);
    const amount = Math.max(0, Number(credits) || 0);
    s.balance += amount;
    s.rewards.push({ ts, kind, credits: amount, ref });
    if (kind === 'feedback_resolved' && ref) s.rewardedFeedback[ref] = true;
    if (kind === 'feedback_voted' && ref) s.rewardedVotes[ref] = true;
    return { state: s, credits: amount };
  }

  // PURA (DC2): true se quel feedback ha già ricevuto il premio voto per questo
  // utente (la cache crediti è già per-account). Usata per decidere SENZA I/O se
  // accreditare — il chiamante async (awardVoteOnce) la usa per restare idempotente
  // anche se invocata più volte di fila (cambio voto, doppio click, retry di rete).
  function isVoteRewardPending(state, feedbackId) {
    const s = ensure(state);
    return !!feedbackId && !s.rewardedVotes[feedbackId];
  }

  // ── Spesa anti-spam (DC4 — riapertura bacheca) ──────────────────────────────
  // PURA: "può permetterselo → scala ESATTAMENTE amount" altrimenti "rifiuta,
  // saldo INTOCCATO". Niente saldo negativo, niente scalo parziale. Diversa da
  // applyConsumption (che clampa a 0 e scala sempre, usata per il costo AI
  // dietro le quinte): qui è un costo NOTO e fisso pagato di tasca dall'utente,
  // quindi un saldo insufficiente deve bloccare l'azione, non far scendere il
  // saldo sotto zero o farla passare gratis.
  // Ritorna { state, ok, balance }: `state` è SEMPRE quello passato in input se
  // ok=false (nessuna mutazione), con balance aggiornato se ok=true.
  function applyConsumptionIfAffordable(state, amount) {
    const s = ensure(state);
    const cost = Math.max(0, Number(amount) || 0);
    if (s.balance < cost) {
      return { state: s, ok: false, balance: Math.round(s.balance) };
    }
    s.balance -= cost;
    return { state: s, ok: true, balance: Math.round(s.balance) };
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
  // opts.autoFeedbackEnabled: se true, applica anche il bonus giornaliero F4.
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

  // True se quel feedback ha già ricevuto la ricompensa di risoluzione (C5).
  async function wasFeedbackRewarded(id) {
    const state = await load();
    return !!state.rewardedFeedback[id];
  }

  // True se quel feedback ha già ricevuto il premio voto (DC2) per l'utente
  // corrente (la cache è già per-account, vedi ensureAccountSync nell'handler).
  async function wasVoteRewarded(id) {
    const state = await load();
    return !!state.rewardedVotes[id];
  }

  // Accredita il premio voto UNA SOLA VOLTA per feedback per utente (DC2).
  // Idempotente: se `feedbackId` è già in rewardedVotes non accredita di nuovo
  // (es. l'utente cambia idea works↔broken, o rivota lo stesso feedback) e
  // ritorna { credits: 0, awarded: false }. Altrimenti accredita `amount` e
  // marca il feedback come premiato. Ritorna { credits, balance, awarded }.
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

  // Scala `amount` crediti SOLO se il saldo basta (DC4 — riapertura bacheca,
  // anti-spam). Logga la spesa come un award negativo (kind 'board_reopen',
  // ref = id del feedback originale riaperto) così compare nello storico
  // `rewards` accanto alle ricompense — utile per audit ("ho speso 5 crediti
  // per riaprire #22"). Se il saldo non basta NON scrive nulla e ritorna
  // { ok:false, balance } col saldo INVARIATO: il chiamante mostra il rifiuto
  // senza che l'utente perda crediti per un tentativo respinto.
  async function spendIfAffordable(amount, { kind = 'spend', ref = null } = {}) {
    const state = await load();
    const { ok, balance } = applyConsumptionIfAffordable(state, amount);
    if (!ok) return { ok: false, balance };
    state.rewards.push({ ts: Date.now(), kind, credits: -Math.abs(Number(amount) || 0), ref });
    await writeState(state);
    emitChange(state, 'spend');
    return { ok: true, balance };
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
    freshState, ensure, applyRefill, costEurToCredits, rewardForPriority,
    applyConsumption, applyAward, isVoteRewardPending, applyConsumptionIfAffordable,
    publicView, dateKey, daysBetween,
    // async (runtime)
    load, getPublic, recordConsumption, award, wasFeedbackRewarded,
    wasVoteRewarded, awardVoteOnce, spendIfAffordable,
    readState, writeState, adopt, setOwner, onChange,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
