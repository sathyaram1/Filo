// Tracking costi e limite hard. Granularità mensile, persistenza in chrome.storage.local.

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;

  function monthKey(date = new Date()) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async function getState() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.COSTS);
    return res[STORAGE_KEYS.COSTS] || { months: {} };
  }

  async function setState(state) {
    await chrome.storage.local.set({ [STORAGE_KEYS.COSTS]: state });
  }

  function ensureMonth(state, month) {
    if (!state.months[month]) {
      state.months[month] = { totalEur: 0, byAction: {}, byProvider: {} };
    }
    return state.months[month];
  }

  // Stima costo (USD) -> ritorna EUR. Se il fornitore ha già detto quanto è
  // costata la chiamata (`usage.costUsd`: voce, dettatura, indicizzazione, che
  // non si contano a token), quel numero vale più di qualunque listino.
  function estimateCostEur({ usage, pricing, usdToEur }) {
    const direct = usage && Number(usage.costUsd);
    if (Number.isFinite(direct) && direct > 0) return direct * (usdToEur || 0.92);
    if (!pricing) return 0;
    const inUsd = ((usage.promptTokens || 0) / 1_000_000) * (pricing.input || 0);
    const outUsd = ((usage.completionTokens || 0) / 1_000_000) * (pricing.output || 0);
    return (inUsd + outUsd) * (usdToEur || 0.92);
  }

  async function getMonthly(month = monthKey()) {
    const state = await getState();
    return state.months[month] || { totalEur: 0, byAction: {}, byProvider: {} };
  }

  // Il registro d'uso delle stime di costo (#819): token medi per funzione, un campione per uso. Un uso fatto di più
  // chiamate (i giri di strumenti di un messaggio in chat) gira dentro `unUso` e diventa un campione solo.
  let usoCorrente = null;
  try { usoCorrente = new (require('async_hooks').AsyncLocalStorage)(); } catch (_) { usoCorrente = null; }

  function campioneDi(model, usage) {
    const u = usage || {};
    return {
      model: String(model || ''),
      prompt: Number(u.promptTokens) || 0,
      completion: Number(u.completionTokens) || 0,
      cached: Number(u.cachedPromptTokens) || 0,
      usd: Number(u.costUsd) || 0,
    };
  }

  async function aggiungiAlRegistro(action, campione) {
    const S = global.SN_STIMA_COSTO;
    if (!S || !action) return;
    const state = await getState();
    state.tokens = S.aggiungiCampione(state.tokens || {}, action, campione);
    await setState(state);
  }

  async function unUso(action, fn) {
    if (!usoCorrente) return fn();
    const uso = { action, campione: null };
    try {
      return await usoCorrente.run(uso, fn);
    } finally {
      if (uso.campione) { try { await aggiungiAlRegistro(action, uso.campione); } catch (_) {} }
    }
  }

  async function registroToken() {
    const state = await getState();
    return state.tokens || {};
  }

  async function record({ action, provider, model, usage, pricing, usdToEur }) {
    const eur = estimateCostEur({ usage, pricing, usdToEur });
    const state = await getState();
    const m = ensureMonth(state, monthKey());
    m.totalEur += eur;
    m.byAction[action] = (m.byAction[action] || 0) + eur;
    m.byProvider[provider] = (m.byProvider[provider] || 0) + eur;
    const campione = campioneDi(model, usage);
    const uso = usoCorrente && usoCorrente.getStore();
    if (uso && uso.action === action) {
      const c = uso.campione || { model: campione.model, prompt: 0, completion: 0, cached: 0, usd: 0 };
      for (const k of ['prompt', 'completion', 'cached', 'usd']) c[k] += campione[k];
      uso.campione = c;
    } else if (global.SN_STIMA_COSTO) {
      state.tokens = global.SN_STIMA_COSTO.aggiungiCampione(state.tokens || {}, action, campione);
    }
    await setState(state);
    // Conteggio crediti (gamification): 1 credito = 0,08 centesimi. Il costo €
    // resta qui dietro le quinte; il motore crediti converte e scala il saldo.
    // Coperti così TUTTI i call site AI senza ritoccarli uno per uno.
    //
    // I crediti usano un costo NOZIONALE, non `eur`: `eur` è 0 quando non c'è
    // un listino per il modello, e un saldo che non si muove sembra rotto. Il
    // prezzo nozionale (listino del modello) fa scendere i crediti anche allora,
    // senza toccare il limite di spesa REALE qui sopra (che resta su `eur`).
    // Precedenza: prezzo reale passato → listino nozionale del modello →
    // ripiego, così una chiamata reale non costa mai 0 crediti.
    const C = global.SN_CONST || {};
    const creditPricing = pricing
      || (C.notionalPricingFor && C.notionalPricingFor(model))
      || C.NOTIONAL_PRICING_FALLBACK
      || null;
    const creditEur = estimateCostEur({ usage, pricing: creditPricing, usdToEur });
    try {
      await global.SN_CREDITS?.recordConsumption({ action, costEur: creditEur, provider, model, usage });
    } catch (_) { /* i crediti non devono mai far fallire una chiamata AI */ }
    // Registro d'uso sul server (#598): una riga per chiamata fatta con la
    // chiave personale. Decide l'handler wallet se scriverla; qui si passa
    // solo quello che si sa. Best-effort come i crediti.
    try {
      await global.SN_WALLET_MAIN?.recordUsage({ action, provider, model, servedBy: usage && usage.servedBy, usage });
    } catch (_) {}
    return eur;
  }

  async function isOverLimit(monthlyLimitEur) {
    if (!monthlyLimitEur || monthlyLimitEur <= 0) return false;
    const m = await getMonthly();
    return m.totalEur >= monthlyLimitEur;
  }

  global.SN_COSTS = { record, getMonthly, isOverLimit, estimateCostEur, monthKey, getState, unUso, registroToken };
})(typeof globalThis !== 'undefined' ? globalThis : self);
