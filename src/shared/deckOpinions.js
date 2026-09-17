// Pareri LLM e auto-tag del deck builder (logica pura), l'I/O in services/deckOpinions.js.
// Un parere è cacheato per (carta, versione mazzo): quando il mazzo avanza resta STANTIO.
// Un giudizio (carta, tag) si cachea cross-mazzo solo se il tag non cita mazzo o commander.

(function (global) {
  'use strict';

  function normTag(t) { return String(t || '').trim().toLowerCase(); }

  // CONTESTUALE = il giudizio dipende dal mazzo: cita commander, sinergie o possessivi.
  // Il resto è context-free e si cachea cross-mazzo.
  const CONTEXTUAL_RE = /\b(commander|comandante|generale|mazzo|deck|sinergi\w*|combo|mio|mia|miei|mie|nostro|nostra)\b/i;
  function isContextFreeTag(tag) {
    return !CONTEXTUAL_RE.test(String(tag || ''));
  }

  // Stantio = il mazzo è avanzato oltre la versione del parere.
  // Entry assente → non stantio: non esiste.
  function isStale(entry, deck) {
    if (!entry) return false;
    return (Number(deck && deck.versione) || 1) > (Number(entry.versione) || 0);
  }

  // Parsing tollerante del JSON dell'LLM, stessa filosofia di parseAgentReply.
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

  // Accetta sia { sintesi, pareri } sia un array nudo; ritorna sempre { opinions, sintesi }.
  // Gli id senza parere testuale si scartano: mai salvare pareri vuoti.
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

  // Accetta la mappa id → tag o un array di { id, tags }.
  // Lista vuota = «nessun tag», cacheabile; id ASSENTE = «non giudicata», non tocca nulla.
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

  // tagCache: { cardId → { tag → bool } }, solo tag context-free.
  // All'LLM va solo la carta con almeno una coppia (carta, tag) non coperta dalla cache.
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

  // Un id omesso dall'LLM non è «false» ma «non giudicato»: mai in una cache permanente.
  // Ritorna una NUOVA mappa.
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

  // Si allineano solo i tag RICHIESTI: gli altri e le carte non giudicate restano intatti.
  // Un solo touch, e solo se qualcosa è cambiato davvero.
  function applyTagMembership(deck, tags, membership) {
    const norm = (tags || []).map(normTag).filter(Boolean);
    const requested = new Set(norm);
    let changed = false;
    let taggedCount = 0;
    const carte = deck.carte.map((c) => {
      const judgedTags = membership && membership[c.scryfall_id];
      if (!Array.isArray(judgedTags)) return c;
      const matched = judgedTags.filter((t) => requested.has(t));
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

  // Filtro semantico: la query Scryfall è larga, un LLM economico tiene solo le conformi.
  // Il giudizio (carta, criterio) si cachea cross-ricerca: non dipende mai dal mazzo.

  // Due ricerche scritte uguale a meno di spazi e maiuscole condividono i giudizi in cache.
  function normCriterion(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Solo gli id davvero giudicati, mai quelli inventati dal modello.
  // I giudicati fuori da «keep» sono scarti: informazione cacheabile dal chiamante.
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

  // Separa gli id già decisi in cache per QUESTO criterio (solo i true) da quelli da fare.
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

  // Solo gli id davvero giudicati. Ritorna una NUOVA mappa, mai muta l'input.
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
