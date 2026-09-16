// LRU in RAM per l'audio della sintesi vocale: è grosso (~64KB per secondo di
// parlato) e in storage.json rallenterebbe ogni lettura/scrittura; entro la sessione
// la seconda lettura è istantanea, allo spegnimento si svuota ed è accettabile.
// Factory pura (niente Electron): i test provano l'eviction senza aprire finestre.

(function (global) {
  'use strict';

  function createTtsCache(opts) {
    const maxBytes = (opts && opts.maxBytes) || 64 * 1024 * 1024; // 64MB default
    // Map mantiene l'ordine di inserimento: la prima chiave è la meno recente.
    const map = new Map();
    let totalBytes = 0;

    function sizeOf(val) {
      return (val && val.audioBase64 ? val.audioBase64.length : 0);
    }

    function get(key) {
      const v = map.get(key);
      if (!v) return null;
      // Bump LRU: rimuovi e re-inserisci.
      map.delete(key);
      map.set(key, v);
      return v;
    }

    function set(key, val) {
      const bytes = sizeOf(val);
      // Un elemento più grande dell'intera cache non si memorizza: svuoterebbe tutto
      // restando comunque non riutilizzabile.
      if (bytes > maxBytes) return;
      if (map.has(key)) {
        totalBytes -= map.get(key).bytes || 0;
        map.delete(key);
      }
      const entry = { audioBase64: val.audioBase64, mimeType: val.mimeType, bytes };
      map.set(key, entry);
      totalBytes += bytes;
      while (totalBytes > maxBytes && map.size > 1) {
        const oldest = map.keys().next().value;
        totalBytes -= (map.get(oldest).bytes || 0);
        map.delete(oldest);
      }
    }

    function clear() {
      map.clear();
      totalBytes = 0;
    }

    return {
      get,
      set,
      clear,
      get size() { return map.size; },
      get bytes() { return totalBytes; },
    };
  }

  global.SN_TTS_CACHE = { createTtsCache };
})(typeof globalThis !== 'undefined' ? globalThis : self);
