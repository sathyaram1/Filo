// Pareri LLM e auto-tag del deck builder (DECK-BUILDER-SPEC.md §6-§7) —
// SOLO logica pura: chiavi/staleness della cache pareri, parsing tollerante
// delle risposte batch dell'LLM, classificazione dei tag (context-free vs
// contestuali) e applicazione della membership dei tag al mazzo.
// Niente rete, niente storage: la parte I/O vive in
// src/main/services/deckOpinions.js. Unit test: tests/unit/deckOpinions.test.mjs.
//
// Invarianti chiave (§6.2, §7):
// - Un parere è cacheato per (carta, versione mazzo): quando `deck.versione`
//   supera la versione del parere, il parere è STANTIO ma resta visibile
//   (pallino discreto), mai cancellato in automatico.
// - Un giudizio (carta, tag) è cacheabile PERMANENTEMENTE cross-mazzo solo se
//   il tag è context-free (dipende dal solo testo della carta). I tag che
//   citano il mazzo/commander sono contestuali: mai in cache.

(function (global) {
  'use strict';

  function normTag(t) { return String(t || '').trim().toLowerCase(); }

  // Tag CONTESTUALE = il giudizio dipende dal mazzo, non solo dalla carta:
  // cita il commander, il mazzo stesso, sinergie o possessivi. Tutto il resto
  // ("ramp", "draw", "payoff self-mill") è context-free → cache cross-mazzo.
  const CONTEXTUAL_RE = /\b(commander|comandante|generale|mazzo|deck|sinergi\w*|combo|mio|mia|miei|mie|nostro|nostra)\b/i;
  function isContextFreeTag(tag) {
    return !CONTEXTUAL_RE.test(String(tag || ''));
  }

  // Parere stantio (§6.2): il mazzo è avanzato oltre la versione su cui il
  // parere è stato calcolato. entry assente → non stantio (non esiste).
  function isStale(entry, deck) {
    if (!entry) return false;
    return (Number(deck && deck.versione) || 1) > (Number(entry.versione) || 0);
  }

  // ── Parsing tollerante del JSON dell'LLM (stessa filosofia di
  //    parseAgentReply: fence ```…```, testo intero, primo blocco JSON). ─────
  function jsonCandidates(text) {
    const raw = String(text || '').trim();
    const out = [];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) out.push(fence[1].trim());
    out.push(raw);
    for (const open of ['{', '[']) {
      const close = open === '{' ? '}' : ']';
      const i = raw.indexOf(open);
      if (i >= 0) out.push(raw.slice(i, raw.lastIndexOf(close) + 1));
    }
    return out;
  }

  function firstJson(text) {
    for (const c of jsonCandidates(text)) {
      try {
        const o = JSON.parse(c);
        if (o && typeof o === 'object') return o;
      } catch (_) { /* prova il prossimo */ }
    }
    return null;
  }

  // Risposta del batch pareri (§6): accetta sia
  //   { "sintesi": "...", "pareri": [{ "id": "...", "parere": "..." }, ...] }
  // sia un array nudo di { id, parere }. Ritorna sempre
  //   { opinions: { id → testo }, sintesi: string }.
  // Id senza parere testuale si scartano (mai salvare pareri vuoti).
  function parseOpinionBatch(text) {
    const o = firstJson(text);
    const out = { opinions: {}, sintesi: '' };
    if (!o) return out;
    const list = Array.isArray(o) ? o : (Array.isArray(o.pareri) ? o.pareri : []);
    if (!Array.isArray(o) && typeof o.sintesi === 'string') out.sintesi = o.sintesi.trim();
    for (const it of list) {
      const id = String((it && it.id) || '').trim();
      const parere = String((it && (it.parere || it.opinion || it.text)) || '').trim();
      if (id && parere) out.opinions[id] = parere;
    }
    return out;
  }

  // Risposta del batch auto-tag (§7): accetta sia la mappa
  //   { "<scryfall_id>": ["ramp", "draw"], ... }
  // sia un array di { id, tags }. Ritorna { id → [tag normalizzati] }.
  // Un id presente con lista vuota significa "giudicata: nessun tag" — è
  // informazione (cacheabile come false), diversa da un id ASSENTE (non
  // giudicata: non toccare né cache né mazzo).
  function parseTagBatch(text) {
    const o = firstJson(text);
    const out = {};
    if (!o) return out;
    const put = (id, tags) => {
      const k = String(id || '').trim();
      if (!k) return;
      out[k] = (Array.isArray(tags) ? tags : []).map(normTag).filter(Boolean);
    };
    if (Array.isArray(o)) {
      for (const it of o) if (it && typeof it === 'object') put(it.id, it.tags);
    } else {
      for (const [id, tags] of Object.entries(o)) {
        if (Array.isArray(tags)) put(id, tags);
      }
    }
    return out;
  }

  // ── Piano di tagging con cache (§7) ────────────────────────────────────────
  // tagCache: { cardId → { tag → bool } } (solo tag context-free).
  // Una carta va giudicata dall'LLM se ha almeno una coppia (carta, tag) non
  // risolvibile dalla cache: tag contestuale (mai in cache) o context-free
  // mancante. Le carte interamente coperte dalla cache saltano l'LLM.
  // Ritorna { judgeIds, membershipFromCache: { cardId → [tag] } }.
  function planTagJudgments({ cardIds, tags, tagCache }) {
    const norm = (tags || []).map(normTag).filter(Boolean);
    const cache = tagCache && typeof tagCache === 'object' ? tagCache : {};
    const judgeIds = [];
    const membershipFromCache = {};
    for (const rawId of cardIds || []) {
      const id = String(rawId);
      const entry = cache[id] && typeof cache[id] === 'object' ? cache[id] : {};
      let missing = false;
      const matched = [];
      for (const t of norm) {
        if (!isContextFreeTag(t) || typeof entry[t] !== 'boolean') { missing = true; break; }
        if (entry[t]) matched.push(t);
      }
      if (missing) judgeIds.push(id);
      else membershipFromCache[id] = matched;
    }
    return { judgeIds, membershipFromCache };
  }

  // Aggiorna la cache (carta, tag) coi giudizi freschi: SOLO tag context-free,
  // SOLO carte presenti in `judged` (un id omesso dall'LLM non è "false", è
  // "non giudicato" — non va mai scritto in una cache permanente).
  // Ritorna una NUOVA mappa (mai mutare l'input).
  function updateTagCache(tagCache, tags, judged) {
    const norm = (tags || []).map(normTag).filter(Boolean);
    const cacheable = norm.filter(isContextFreeTag);
    const next = {};
    for (const [id, e] of Object.entries(tagCache && typeof tagCache === 'object' ? tagCache : {})) {
      next[id] = { ...e };
    }
    for (const [id, matched] of Object.entries(judged || {})) {
      if (!next[id]) next[id] = {};
      for (const t of cacheable) next[id][t] = matched.includes(t);
    }
    return next;
  }

  // Applica la membership dei tag RICHIESTI al mazzo: per ogni carta giudicata
  // (presente in `membership`) i tag richiesti si allineano al giudizio
  // (aggiunti se pertinenti, rimossi se non lo sono più); i tag NON richiesti
  // restano intatti. Le carte non giudicate non si toccano. Un solo touch (la
  // versione avanza di 1) e solo se qualcosa è cambiato davvero.
  // Richiede SN_DECKS (touch) su global. Ritorna { deck, changed, taggedCount }.
  function applyTagMembership(deck, tags, membership) {
    const norm = (tags || []).map(normTag).filter(Boolean);
    const requested = new Set(norm);
    let changed = false;
    let taggedCount = 0;
    const carte = deck.carte.map((c) => {
      const judgedTags = membership && membership[c.scryfall_id];
      if (!Array.isArray(judgedTags)) return c;
      const matched = judgedTags.filter((t) => requested.has(t));
      // Tag esistenti non richiesti restano; i richiesti si riallineano.
      const kept = (c.tags || []).filter((t) => !requested.has(normTag(t)));
      const nextTags = [...kept, ...norm.filter((t) => matched.includes(t))];
      if (matched.length) taggedCount++;
      const same = nextTags.length === (c.tags || []).length
        && nextTags.every((t, i) => t === c.tags[i]);
      if (same) return c;
      changed = true;
      return { ...c, tags: nextTags };
    });
    if (!changed) return { deck, changed: false, taggedCount };
    const touched = global.SN_DECKS && typeof global.SN_DECKS.touch === 'function'
      ? global.SN_DECKS.touch({ ...deck, carte })
      : { ...deck, carte, versione: (Number(deck.versione) || 1) + 1 };
    return { deck: touched, changed: true, taggedCount };
  }

  // ── Filtro semantico dei risultati di ricerca (§4.1) ───────────────────────
  // La chat produce una query Scryfall LARGA (con sinonimi) + un "criterio" in
  // linguaggio naturale; il sistema tiene solo le carte che, giudicate da un
  // LLM economico, rispettano quel criterio. Il giudizio (carta, criterio) →
  // bool è cacheabile PERMANENTEMENTE cross-ricerca: dipende solo dal testo
  // della carta e dal criterio, mai dal mazzo. Cache: { cardId → { critKey → bool } }.

  // Chiave di cache di un criterio: minuscolo, spazi normalizzati. Due ricerche
  // scritte uguale (a meno di spazi/maiuscole) condividono i giudizi in cache.
  function normCriterion(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Risposta del batch filtro (§4.1): { "keep": ["id", ...] } oppure un array
  // nudo di id. Ritorna un Set degli id "keep" RISTRETTO a quelli davvero
  // giudicati (mai id inventati dal modello). Gli id giudicati e non presenti in
  // "keep" sono "scartati" (bool false), informazione cacheabile dal chiamante.
  function parseSearchKeep(text, judgeIds) {
    const allow = new Set((judgeIds || []).map(String));
    const o = firstJson(text);
    const out = new Set();
    if (!o) return out;
    const list = Array.isArray(o) ? o : (Array.isArray(o.keep) ? o.keep : []);
    for (const it of list) {
      const id = String(it || '').trim();
      if (id && allow.has(id)) out.add(id);
    }
    return out;
  }

  // Piano del filtro con cache: per gli id candidati (nell'ORDINE dato) separa
  // quelli già decisi in cache per QUESTO criterio (keepFromCache = solo i true)
  // da quelli ancora da giudicare (judgeIds). searchCache: { cardId → { critKey → bool } }.
  // Ritorna { judgeIds, keepFromCache } — keepFromCache preserva l'ordine.
  function planSearchFilter({ cardIds, criterion, searchCache }) {
    const key = normCriterion(criterion);
    const cache = searchCache && typeof searchCache === 'object' ? searchCache : {};
    const judgeIds = [];
    const keepFromCache = [];
    for (const rawId of cardIds || []) {
      const id = String(rawId);
      const entry = cache[id] && typeof cache[id] === 'object' ? cache[id] : {};
      if (typeof entry[key] === 'boolean') {
        if (entry[key]) keepFromCache.push(id);
      } else {
        judgeIds.push(id);
      }
    }
    return { judgeIds, keepFromCache };
  }

  // Aggiorna la cache coi giudizi freschi (id → bool) per un criterio. Ritorna
  // una NUOVA mappa (mai mutare l'input). Solo gli id davvero giudicati.
  function updateSearchCache(searchCache, criterion, judged) {
    const key = normCriterion(criterion);
    if (!key) return searchCache && typeof searchCache === 'object' ? searchCache : {};
    const next = {};
    for (const [id, e] of Object.entries(searchCache && typeof searchCache === 'object' ? searchCache : {})) {
      next[id] = { ...e };
    }
    for (const [id, matched] of Object.entries(judged || {})) {
      if (!next[id]) next[id] = {};
      next[id][key] = !!matched;
    }
    return next;
  }

  global.SN_DECK_OPINIONS = {
    normTag,
    isContextFreeTag,
    isStale,
    parseOpinionBatch,
    parseTagBatch,
    planTagJudgments,
    updateTagCache,
    applyTagMembership,
    normCriterion,
    parseSearchKeep,
    planSearchFilter,
    updateSearchCache,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
