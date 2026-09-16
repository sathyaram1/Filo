// Cache persistente delle chiamate LLM in chrome.storage.local (STORAGE_KEYS.AI_CACHE): chiave = SHA-256 di {provider, model, messages}.
// Eviction delle entry meno usate di recente quando si supera AI_CACHE_MAX_ENTRIES.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, AI_CACHE_MAX_ENTRIES } = global.SN_CONST;

  async function hashKey({ provider, model, messages }) {
    const payload = JSON.stringify({ provider, model, messages });
    const enc = new TextEncoder().encode(payload);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async function readAll() {
    const r = await chrome.storage.local.get(STORAGE_KEYS.AI_CACHE);
    return r[STORAGE_KEYS.AI_CACHE] || {};
  }

  async function writeAll(map) {
    await chrome.storage.local.set({ [STORAGE_KEYS.AI_CACHE]: map });
  }

  async function get({ provider, model, messages }) {
    try {
      const key = await hashKey({ provider, model, messages });
      const map = await readAll();
      const entry = map[key];
      if (!entry) return null;
      entry.lastUsed = Date.now();
      map[key] = entry;
      // best-effort: non aspettiamo la scrittura, la lettura non deve rallentare per un aggiornamento di timestamp.
      writeAll(map).catch(() => {});
      return entry;
    } catch (_) {
      return null;
    }
  }

  async function set({ provider, model, messages, text, usage }) {
    try {
      const key = await hashKey({ provider, model, messages });
      const map = await readAll();
      const now = Date.now();
      map[key] = { text, usage: usage || {}, provider, model, ts: now, lastUsed: now };

      const keys = Object.keys(map);
      if (keys.length > AI_CACHE_MAX_ENTRIES) {
        keys.sort((a, b) => (map[a].lastUsed || map[a].ts || 0) - (map[b].lastUsed || map[b].ts || 0));
        const toRemove = keys.length - AI_CACHE_MAX_ENTRIES;
        for (let i = 0; i < toRemove; i++) delete map[keys[i]];
      }
      await writeAll(map);
    } catch (_) {
      // cache best-effort: un errore (storage pieno, ecc.) non deve far fallire la chiamata.
    }
  }

  async function clear() {
    await chrome.storage.local.remove(STORAGE_KEYS.AI_CACHE);
  }

  global.SN_AI_CACHE = { get, set, clear, hashKey };
})(typeof globalThis !== 'undefined' ? globalThis : self);
