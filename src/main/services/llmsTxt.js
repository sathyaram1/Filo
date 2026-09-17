// Fetcher di /llms.txt: le istruzioni che un sito dà ai bot su come usarlo (llmstxt.org).
// Una prova per dominio ogni 24h, esito o assenza in cache; il testo si tronca a 20 KB.
// Espone SN_LLMS_TXT = { get(domain) → { text, cachedAt, present } | null }.

(function (global) {
  'use strict';

  const STORAGE_KEY = 'sn_llmstxt_cache';
  const TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_BYTES = 20 * 1024;
  const FETCH_TIMEOUT_MS = 4000;
  // Bound difensivo sui domini in cache: oltre il tetto si scartano i più vecchi.
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

  // Si preserva la testa: la convenzione mette in alto la sintesi, la parte più informativa.
  function truncate(text) {
    if (typeof text !== 'string') return '';
    // Bytes pessimisti: 1 char ≤ 4 byte UTF-8, quindi si taglia per char.
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
      // Evita di scaricare l'HTML di una 404 mascherata da 200.
      if (ct.includes('text/html')) return { present: false, text: '' };
      const raw = await r.text();
      // Body che sembra HTML (SPA che servono index.html ovunque): il file si considera assente.
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
    const sorted = keys.sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0));
    const toRemove = sorted.slice(0, sorted.length - MAX_DOMAINS_CACHED);
    for (const k of toRemove) delete cache[k];
    return cache;
  }

  // Cache fresca: nessuna rete. Non lancia mai: gli errori tornano { text:'', present:false }.
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
