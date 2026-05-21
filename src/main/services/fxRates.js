// Tassi di cambio EUR -> altre valute. Fetch lazy da frankfurter.dev (BCE,
// gratuito, niente API key). Cache in chrome.storage.local con TTL 24h.
// Usato dai prompt explain/explainDeep per far convertire valute al modello
// tramite il marker [[calc: ...]] (vedi popup.js).

(function (global) {
  'use strict';

  const STORAGE_KEY = 'sn_fx_rates';
  const TTL_MS = 24 * 60 * 60 * 1000;
  const TIMEOUT_MS = 4000;
  const SYMBOLS = ['USD', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK'];
  const URL = `https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${SYMBOLS.join(',')}`;

  // Fallback statico se la fetch fallisce al primo uso e non c'è cache.
  // Valori indicativi ~2026, usati solo come ultima spiaggia.
  const FALLBACK = {
    base: 'EUR',
    date: '2026-01-01',
    rates: { USD: 1.08, GBP: 0.85, CHF: 0.94, JPY: 165, CNY: 7.8, CAD: 1.47, AUD: 1.65, SEK: 11.2, NOK: 11.5, DKK: 7.46 },
    stale: true,
  };

  let inflight = null;

  async function readCache() {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      return r[STORAGE_KEY] || null;
    } catch (_) {
      return null;
    }
  }

  async function writeCache(data) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (_) {}
  }

  async function fetchFresh() {
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, TIMEOUT_MS);
    try {
      const res = await fetch(URL, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`fx ${res.status}`);
      const json = await res.json();
      if (!json || !json.rates) throw new Error('fx malformed');
      return {
        base: json.base || 'EUR',
        date: json.date || new Date().toISOString().slice(0, 10),
        rates: json.rates,
        fetchedAt: Date.now(),
      };
    } finally {
      clearTimeout(to);
    }
  }

  // Ritorna sempre qualcosa (cache fresca, cache stale, o fallback).
  // Aggiorna in background se la cache è scaduta ma utilizzabile.
  async function get() {
    const cached = await readCache();
    const now = Date.now();
    if (cached && cached.fetchedAt && (now - cached.fetchedAt) < TTL_MS) {
      return cached;
    }
    if (inflight) {
      try { return await inflight; } catch (_) { return cached || FALLBACK; }
    }
    inflight = (async () => {
      try {
        const fresh = await fetchFresh();
        await writeCache(fresh);
        return fresh;
      } catch (e) {
        return cached || FALLBACK;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  // Formatta i tassi come riga compatta per il prompt.
  // Esempio: "1 EUR = 1.08 USD, 0.85 GBP, ..."
  function formatForPrompt(data) {
    if (!data || !data.rates) return '';
    const parts = SYMBOLS
      .filter((s) => typeof data.rates[s] === 'number')
      .map((s) => `${trimNum(data.rates[s])} ${s}`);
    if (!parts.length) return '';
    const date = data.date || '';
    const stale = data.stale ? ' (stimati)' : '';
    return `Cambi attuali al ${date}${stale}: 1 EUR = ${parts.join(', ')}.`;
  }

  function trimNum(n) {
    if (!Number.isFinite(n)) return String(n);
    if (n >= 100) return n.toFixed(1);
    if (n >= 10) return n.toFixed(2);
    return n.toFixed(3);
  }

  global.SN_FX = { get, formatForPrompt };
})(typeof globalThis !== 'undefined' ? globalThis : self);
