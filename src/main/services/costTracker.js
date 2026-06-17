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

  // Stima costo (USD) -> ritorna EUR.
  function estimateCostEur({ usage, pricing, usdToEur }) {
    if (!pricing) return 0;
    const inUsd = ((usage.promptTokens || 0) / 1_000_000) * (pricing.input || 0);
    const outUsd = ((usage.completionTokens || 0) / 1_000_000) * (pricing.output || 0);
    return (inUsd + outUsd) * (usdToEur || 0.92);
  }

  async function getMonthly(month = monthKey()) {
    const state = await getState();
    return state.months[month] || { totalEur: 0, byAction: {}, byProvider: {} };
  }

  async function record({ action, provider, model, usage, pricing, usdToEur }) {
    const eur = estimateCostEur({ usage, pricing, usdToEur });
    const state = await getState();
    const m = ensureMonth(state, monthKey());
    m.totalEur += eur;
    m.byAction[action] = (m.byAction[action] || 0) + eur;
    m.byProvider[provider] = (m.byProvider[provider] || 0) + eur;
    await setState(state);
    // Conteggio crediti (gamification): 1 credito = 0,08 centesimi. Il costo €
    // resta qui dietro le quinte; il motore crediti converte e scala il saldo.
    // Coperti così TUTTI i call site AI senza ritoccarli uno per uno.
    try {
      await global.SN_CREDITS?.recordConsumption({ action, costEur: eur, provider, model, usage });
    } catch (_) { /* i crediti non devono mai far fallire una chiamata AI */ }
    return eur;
  }

  async function isOverLimit(monthlyLimitEur) {
    if (!monthlyLimitEur || monthlyLimitEur <= 0) return false;
    const m = await getMonthly();
    return m.totalEur >= monthlyLimitEur;
  }

  global.SN_COSTS = { record, getMonthly, isOverLimit, estimateCostEur, monthKey, getState };
})(typeof globalThis !== 'undefined' ? globalThis : self);
