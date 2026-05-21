// Fetcher di /llms.txt — convenzione emergente per dare istruzioni "machine
// readable" ai bot/LLM su come usare un sito (https://llmstxt.org).
//
// Per ogni dominio proviamo HEAD/GET su https://<host>/llms.txt una volta
// ogni 24h. La risposta (o l'assenza) viene cacheata in chrome.storage.local.
// Cap testo: 20 KB (~5k token), oltre quella soglia tronchiamo.
//
// Espone SN_LLMS_TXT = { get(domain) → { text, cachedAt, present } | null }.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'sn_llmstxt_cache';
  const TTL_MS = 24 * 60 * 60 * 1000;       // 24h
  const MAX_BYTES = 20 * 1024;              // 20KB
  const FETCH_TIMEOUT_MS = 4000;
  // Bound difensivo sul totale della cache (#domini): evita che cresca
  // indefinitamente. Quando lo superiamo, scartiamo gli entry più vecchi.
  const MAX_DOMAINS_CACHED = 500;

  async function readCache() {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    return (r && r[STORAGE_KEY]) || {};
  }
  async function writeCache(obj) {
    await chrome.storage.local.set({ [STORAGE_KEY]: obj });
  }

  function fresh(entry) {
    return entry && (Date.now() - (entry.cachedAt || 0)) < TTL_MS;
  }

  // Tronca a MAX_BYTES preservando la testa del file (di solito è la parte
  // più informativa, e la convenzione llms.txt mette in alto la sintesi).
  function truncate(text) {
    if (typeof text !== 'string') return '';
    // Bytes pessimisti: 1 char ≤ 4 byte UTF-8. Tagliamo per char a MAX_BYTES.
    if (text.length <= MAX_BYTES) return text;
    return text.slice(0, MAX_BYTES) + '\n…[troncato]';
  }

  async function fetchOnce(url) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { method: 'GET', signal: ac.signal, redirect: 'follow' });
      clearTimeout(t);
      if (!r.ok) return { present: false, text: '' };
      const ct = r.headers.get('content-type') || '';
      // Evita di scaricare HTML di una pagina 404 mascherata da 200.
      if (ct.includes('text/html')) return { present: false, text: '' };
      const raw = await r.text();
      // Heuristica: se il body sembra HTML (caso comune di SPA che ritornano
      // index.html per ogni path), considera il file assente.
      if (/^\s*<!DOCTYPE\s+html|^\s*<html[\s>]/i.test(raw)) return { present: false, text: '' };
      return { present: true, text: truncate(raw) };
    } catch (_) {
      clearTimeout(t);
      return { present: false, text: '' };
    }
  }

  async function pruneIfNeeded(cache) {
    const keys = Object.keys(cache);
    if (keys.length <= MAX_DOMAINS_CACHED) return cache;
    // Ordina per cachedAt asc e tieni solo i più recenti.
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    const toRemove = sorted.slice(0, sorted.length - MAX_DOMAINS_CACHED);
    for (const k of toRemove) delete cache[k];
    return cache;
  }

  // Ritorna { text, present, cachedAt } per il dominio. Se in cache fresca,
  // ritorna senza network. Se stale o assente, fetcha e aggiorna la cache.
  // Non lancia mai: errori → { text:'', present:false }.
  async function get(domain) {
    if (!domain || typeof domain !== 'string') return { text: '', present: false, cachedAt: 0 };
    const cache = await readCache();
    const cached = cache[domain];
    if (cached && fresh(cached)) return cached;

    const url = `https://${domain}/llms.txt`;
    const fetched = await fetchOnce(url);
    const entry = {
      text: fetched.text,
      present: fetched.present,
      cachedAt: Date.now(),
    };
    cache[domain] = entry;
    await writeCache(await pruneIfNeeded(cache));
    return entry;
  }

  global.SN_LLMS_TXT = { get, _internal: { TTL_MS, MAX_BYTES } };
})(typeof globalThis !== 'undefined' ? globalThis : self);
