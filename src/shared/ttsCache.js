// Cache IN-MEMORIA (LRU, limitata per byte) per l'audio della sintesi vocale.
//
// Perché in memoria e non persistente: l'audio TTS è grosso (PCM base64 ~64KB
// per secondo di parlato). Metterlo in storage.json — come fa aiCache per il
// testo — gonfierebbe il file e rallenterebbe ogni lettura/scrittura di storage.
// Una LRU in RAM nel main process risolve la lamentela concreta ("rileggere lo
// stesso pezzo è di nuovo lento"): entro la sessione la seconda lettura è
// istantanea. Allo spegnimento dell'app la cache si svuota: accettabile.
//
// È una factory pura (niente Electron) così i test unitari verificano
// l'eviction senza aprire una finestra. L'istanza viva la crea l'handler TTS
// nel main (src/main/services/handlers/ai.js).

(function (global) {
  'use strict';

  function createTtsCache(opts) {
    const maxBytes = (opts && opts.maxBytes) || 64 * 1024 * 1024; // 64MB default
    // Map mantiene l'ordine di inserimento: la chiave più "vecchia" (meno
    // recentemente usata) è la prima di keys().
    const map = new Map();
    let totalBytes = 0;

    function sizeOf(val) {
      return (val && val.audioBase64 ? val.audioBase64.length : 0);
    }

    function get(key) {
      const v = map.get(key);
      if (!v) return null;
      // Bump LRU: rimuovi e re-inserisci così diventa la più recente.
      map.delete(key);
      map.set(key, v);
      return v;
    }

    function set(key, val) {
      const bytes = sizeOf(val);
      // Un singolo elemento più grande dell'intera cache non si memorizza
      // (svuoterebbe tutto restando comunque non riutilizzabile).
      if (bytes > maxBytes) return;
      if (map.has(key)) {
        totalBytes -= map.get(key).bytes || 0;
        map.delete(key);
      }
      const entry = { audioBase64: val.audioBase64, mimeType: val.mimeType, bytes };
      map.set(key, entry);
      totalBytes += bytes;
      // Eviction: butta i meno recenti finché si rientra nel budget.
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
