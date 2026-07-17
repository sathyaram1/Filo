// Client Scryfall (DECK-BUILDER-SPEC.md §13.2-§13.3) — parte I/O, main process.
// La logica pura (query, semplificazione carte, TTL) è in SN_SCRYFALL_Q
// (src/shared/scryfallQuery.js).
//
// Cache (§13.3):
//   - dati carta: permanenti per i campi statici, il PREZZO si considera
//     stantio dopo PRICE_TTL_MS → chi vuole prezzi freschi passa maxAgeMs
//   - simboli di mana (symbology): permanente (symbol → svg_uri; l'SVG lo
//     carica il renderer via <img>, la CSP filo:// consente https:)
//   - immagini carta: URL diretti https://cards.scryfall.io — le cachea il
//     browser (HTTP cache di Chromium), non duplichiamo su disco
//
// Rate limit di cortesia (~10 req/s): coda interna serializzata con distanza
// minima fra le richieste. Tutte le chiamate passano da qui.

(function (global) {
  'use strict';

  const { STORAGE_KEYS } = global.SN_CONST;
  const Q = global.SN_SCRYFALL_Q;

  const BASE = process.env.FILO_SCRYFALL_BASE || 'https://api.scryfall.com';
  const MIN_GAP_MS = 110;               // ~9 req/s, sotto il tetto di cortesia
  const PRICE_TTL_MS = 6 * 60 * 60 * 1000; // prezzi: stantii dopo 6 ore

  // User-Agent identificativo, OBBLIGATORIO: l'API Scryfall risponde
  // 400 `generic_user_agent` alle richieste con la UA di default della
  // libreria HTTP (il fetch di Node/Electron nel main) — senza questo header
  // OGNI chiamata fallisce in produzione (ricerca in chat, hover sui nomi…).
  let USER_AGENT = 'Filo/0.0.0 (https://singolarita.com)';
  try {
    USER_AGENT = `Filo/${require('../../../package.json').version} (https://singolarita.com)`;
  } catch (_) { /* fallback senza versione */ }

  // Fetch sostituibile nei TEST (niente rete): SN_SCRYFALL._setFetch(fake).
  let _fetch = (...args) => fetch(...args);
  function _setFetch(fn) { _fetch = fn || ((...args) => fetch(...args)); }

  // ── Coda rate-limited ────────────────────────────────────────────────────
  let chain = Promise.resolve();
  let lastAt = 0;
  function throttled(fn) {
    const run = chain.then(async () => {
      const wait = lastAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      return fn();
    });
    // La coda prosegue anche se una richiesta fallisce.
    chain = run.catch(() => {});
    return run;
  }

  async function apiGet(path) {
    return throttled(async () => {
      const res = await _fetch(BASE + path, { headers: { Accept: 'application/json' } });
      if (res.status === 404) return null; // "nessun risultato" per Scryfall
      if (!res.ok) {
        // Scryfall spiega gli errori nel body JSON (`details`, es. la sintassi
        // sbagliata di una query 400): recuperalo, così chi gestisce l'errore
        // può correggere la query o spiegare il problema all'utente invece di
        // mostrare un codice HTTP nudo (#331).
        let details = '';
        try {
          const body = await res.json();
          if (body && body.details) details = String(body.details);
        } catch (_) { /* body non-JSON: pazienza */ }
        const err = new Error(`Scryfall ${res.status} su ${path}${details ? ` — ${details}` : ''}`);
        err.status = res.status;
        err.details = details;
        throw err;
      }
      return res.json();
    });
  }

  // ── Ricerca (§4): il vincolo di identity lo aggiunge il chiamante via
  //    buildSearchQuery; qui si esegue e si semplifica. ─────────────────────
  async function search(userQuery, { identity } = {}) {
    const q = Q.buildSearchQuery(userQuery, identity);
    if (!q) return { cards: [], hasMore: false, query: q };
    const data = await apiGet(`/cards/search?q=${encodeURIComponent(q)}&order=cmc`);
    if (!data) return { cards: [], hasMore: false, query: q };
    const cards = (data.data || []).map(Q.simplifyCard).filter(Boolean);
    cacheCards(cards).catch(() => {});
    return { cards, hasMore: !!data.has_more, query: q };
  }

  // Risoluzione nome fuzzy (§3.5): null se Scryfall non riconosce il nome.
  async function named(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const data = await apiGet(`/cards/named?fuzzy=${encodeURIComponent(n)}`);
    const card = data ? Q.simplifyCard(data) : null;
    if (card) cacheCards([card]).catch(() => {});
    return card;
  }

  // ── Cache dati carta (chiave: scryfall_id) ───────────────────────────────

  async function readCardCache() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SCRYFALL_CARDS);
    const map = res[STORAGE_KEYS.SCRYFALL_CARDS];
    return map && typeof map === 'object' ? map : {};
  }

  async function cacheCards(cards) {
    if (!cards.length) return;
    const map = await readCardCache();
    const t = Date.now();
    for (const c of cards) map[c.id] = { card: c, fetchedAt: t };
    await chrome.storage.local.set({ [STORAGE_KEYS.SCRYFALL_CARDS]: map });
  }

  // Carte per id, dalla cache quando abbastanza fresche (default: i campi
  // statici non scadono → Infinity). Chi vuole PREZZI freschi passa
  // maxAgeMs = PRICE_TTL_MS. Le mancanti/stantie si scaricano una a una
  // (la coda rate-limited le serializza). Ritorna una mappa id → card
  // (id introvabili semplicemente assenti).
  async function cards(ids, { maxAgeMs = Infinity } = {}) {
    const wanted = [...new Set((ids || []).map(String).filter(Boolean))];
    const map = await readCardCache();
    const out = {};
    const missing = [];
    for (const id of wanted) {
      const e = map[id];
      // `producedMana`/`oracleText === undefined` = entry scritta prima che il
      // campo esistesse (schema vecchio): si rifetcha per avere il dato nuovo.
      if (e && Q.isFresh(e.fetchedAt, maxAgeMs) && e.card
          && e.card.producedMana !== undefined && e.card.oracleText !== undefined) out[id] = e.card;
      else missing.push(id);
    }
    const fetched = [];
    for (const id of missing) {
      try {
        const data = await apiGet(`/cards/${encodeURIComponent(id)}`);
        const card = data ? Q.simplifyCard(data) : null;
        if (card) { out[id] = card; fetched.push(card); }
        else if (map[id]) out[id] = map[id].card; // irraggiungibile: meglio stantio che niente
      } catch (_) {
        if (map[id]) out[id] = map[id].card;
      }
    }
    if (fetched.length) await cacheCards(fetched);
    return out;
  }

  async function card(id) {
    const map = await cards([id]);
    return map[String(id)] || null;
  }

  // ── Conteggio ristampe per nome (modulo "Prezzo e dati", §5.2) ───────────
  // `unique=prints` conta tutte le stampe della carta; il numero cambia solo
  // quando esce un set nuovo → cache permanente per nome (minuscolo).
  async function prints(name) {
    const n = String(name || '').trim();
    if (!n) return null;
    const key = n.toLowerCase();
    const res = await chrome.storage.local.get(STORAGE_KEYS.SCRYFALL_PRINTS);
    const map = (res[STORAGE_KEYS.SCRYFALL_PRINTS] && typeof res[STORAGE_KEYS.SCRYFALL_PRINTS] === 'object')
      ? res[STORAGE_KEYS.SCRYFALL_PRINTS] : {};
    if (map[key] && Number.isFinite(Number(map[key].n))) return Number(map[key].n);
    const data = await apiGet(`/cards/search?q=${encodeURIComponent(`!"${n}"`)}&unique=prints`);
    const count = data ? (Number(data.total_cards) || (data.data || []).length) : 0;
    map[key] = { n: count, fetchedAt: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEYS.SCRYFALL_PRINTS]: map });
    return count;
  }

  // ── Simboli di mana (symbology): symbol → svg_uri, cache permanente ──────
  async function symbols() {
    const res = await chrome.storage.local.get(STORAGE_KEYS.SCRYFALL_SYMBOLS);
    const cached = res[STORAGE_KEYS.SCRYFALL_SYMBOLS];
    if (cached && typeof cached === 'object' && Object.keys(cached).length) return cached;
    const data = await apiGet('/symbology');
    const map = {};
    for (const s of (data && data.data) || []) {
      if (s && s.symbol && s.svg_uri) map[s.symbol] = s.svg_uri;
    }
    if (Object.keys(map).length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SCRYFALL_SYMBOLS]: map });
    }
    return map;
  }

  global.SN_SCRYFALL = { search, named, card, cards, symbols, prints, PRICE_TTL_MS, _setFetch };
})(typeof globalThis !== 'undefined' ? globalThis : self);
