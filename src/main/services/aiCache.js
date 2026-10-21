// Cache persistente delle risposte dei modelli: chiave = SHA-256 di {provider, model, messages}, ogni voce sa di che funzione è.
// Il tetto è PER FUNZIONE (#1097.4): le domande che non tornano mai non buttano fuori le spiegazioni già pagate.
// Quali funzioni non ci entrano lo dice solo `esclusa`; prove in tests/unit/aiCache.test.mjs.

(function (global) {
  'use strict';

  const { STORAGE_KEYS, AI_CACHE_MAX_PER_FUNZIONE, ACTIONS } = global.SN_CONST;

  // Chiavi mai uguali due volte: l'Aiuto ha lo screenshot nella richiesta, il correttore la frase di quel momento.
  // Il giudice delle carte ha la sua cache per carta e criterio, e fa fino a venti chiamate a ricerca (#382).
  const ESCLUSE = new Set([ACTIONS.HELP, ACTIONS.SPELLCHECK_SEMANTIC, ACTIONS.DECKS_SEARCH_FILTER]);
  const esclusa = (action) => ESCLUSE.has(action);

  // Le voci scritte prima che la cache sapesse la funzione: restano finché servono, poi scadono.
  const SENZA_FUNZIONE_MS = 30 * 24 * 60 * 60 * 1000;

  // Una lettura non riscrive la mappa: l'ultimo uso (e la funzione, per le voci vecchie) lo porta la prossima scrittura.
  const usati = new Map(); // chiave → { ts, action }

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

  const ultimoUso = (e) => (e && (e.lastUsed || e.ts)) || 0;

  // Le scritture rileggono e riscrivono la mappa intera: in fila, o due spiegazioni pronte insieme si cancellano a
  // vicenda (patterns/chi-rilegge-tutto-e-riscrive-tutto-mette-le-scritture-in-fila.md). Le letture restano libere.
  let coda = Promise.resolve();
  function inCoda(fn) {
    const risultato = coda.then(fn, fn);
    coda = risultato.then(() => {}, () => {});
    return risultato;
  }

  async function get({ provider, model, messages, action = '' }) {
    if (esclusa(action)) return null;
    try {
      const key = await hashKey({ provider, model, messages });
      const entry = (await readAll())[key];
      if (!entry) return null;
      usati.set(key, { ts: Date.now(), action: action || '' });
      return entry;
    } catch (_) {
      return null;
    }
  }

  function applicaUsati(map) {
    for (const [k, u] of usati) {
      const e = map[k];
      if (!e) continue;
      if (u.ts > ultimoUso(e)) e.lastUsed = u.ts;
      if (!e.action && u.action) e.action = u.action;
    }
    usati.clear();
  }

  function sfoltisci(map, now) {
    const perFunzione = new Map();
    for (const k of Object.keys(map)) {
      const e = map[k];
      if (!e || typeof e !== 'object') { delete map[k]; continue; }
      if (!e.action && now - ultimoUso(e) > SENZA_FUNZIONE_MS) { delete map[k]; continue; }
      const f = e.action || '';
      if (!perFunzione.has(f)) perFunzione.set(f, []);
      perFunzione.get(f).push(k);
    }
    for (const chiavi of perFunzione.values()) {
      if (chiavi.length <= AI_CACHE_MAX_PER_FUNZIONE) continue;
      chiavi.sort((a, b) => ultimoUso(map[a]) - ultimoUso(map[b]));
      for (const k of chiavi.slice(0, chiavi.length - AI_CACHE_MAX_PER_FUNZIONE)) delete map[k];
    }
  }

  async function set({ provider, model, messages, text, usage, action = '' }) {
    if (esclusa(action)) return;
    let key;
    try { key = await hashKey({ provider, model, messages }); } catch (_) { return; }
    await inCoda(async () => {
      try {
        const map = await readAll();
        const now = Date.now();
        applicaUsati(map);
        map[key] = { text, usage: usage || {}, provider, model, action: action || '', ts: now, lastUsed: now };
        sfoltisci(map, now);
        await writeAll(map);
      } catch (_) {
        // cache best-effort: ignora errori (storage pieno, ecc.)
      }
    });
  }

  function clear() {
    return inCoda(async () => {
      usati.clear();
      await chrome.storage.local.remove(STORAGE_KEYS.AI_CACHE);
    });
  }

  // Toglie le risposte che `pred` riconosce (quelle di una chat cancellata, #866).
  function togli(pred) {
    return inCoda(async () => {
      const map = await readAll();
      const via = Object.keys(map).filter((k) => map[k] && pred(map[k]));
      if (!via.length) return 0;
      for (const k of via) { delete map[k]; usati.delete(k); }
      await writeAll(map);
      return via.length;
    });
  }

  global.SN_AI_CACHE = { get, set, clear, togli, hashKey, esclusa };
})(typeof globalThis !== 'undefined' ? globalThis : self);
