// Pareri LLM e auto-tag del deck builder (DECK-BUILDER-SPEC.md §6-§7), logica pura: cache pareri, parsing tollerante delle risposte batch, classificazione dei tag e applicazione della membership. L'I/O vive in src/main/services/deckOpinions.js.
// Invarianti (§6.2, §7): un parere è cacheato per (carta, versione mazzo) e quando il mazzo avanza resta visibile ma STANTIO, mai cancellato in automatico. Un giudizio (carta, tag) si cachea permanentemente cross-mazzo solo se il tag è context-free; quelli che citano mazzo o commander sono contestuali e non vanno mai in cache.

(function (global) {
  'use strict';

  function normTag(t) { return String(t || '').trim().toLowerCase(); }

  // CONTESTUALE = il giudizio dipende dal mazzo: cita commander, mazzo, sinergie o possessivi. Il resto è context-free → cache cross-mazzo.
  const CONTEXTUAL_RE = /\b(commander|comandante|generale|mazzo|deck|sinergi\w*|combo|mio|mia|miei|mie|nostro|nostra)\b/i;
  function isContextFreeTag(tag) {
    return !CONTEXTUAL_RE.test(String(tag || ''));
  }

  // Stantio (§6.2) = il mazzo è avanzato oltre la versione del parere. Entry assente → non stantio, non esiste.
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

  // Batch pareri (§6): accetta l'oggetto con `sintesi` e `pareri` o un array nudo, e ritorna sempre { opinions, sintesi }. Gli id senza parere testuale si scartano: mai salvare pareri vuoti.
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

  // Batch auto-tag (§7): accetta la mappa id → tag o un array di { id, tags }. Un id con lista vuota è «giudicata: nessun tag», cacheabile come false; un id ASSENTE è «non giudicata» e non tocca né cache né mazzo.
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

  // tagCache: { cardId → { tag → bool } }, solo tag context-free. Una carta va dall'LLM se ha almeno una coppia (carta, tag) non risolvibile dalla cache; quelle interamente coperte lo saltano.
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

  // Solo tag context-free e solo carte presenti in `judged`: un id omesso dall'LLM non è «false», è «non giudicato», e non va mai in una cache permanente. Ritorna una NUOVA mappa.
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

  // Per ogni carta giudicata i tag RICHIESTI si allineano al giudizio; i non richiesti restano intatti e le carte non giudicate non si toccano. Un solo touch, e solo se qualcosa è cambiato davvero.
  function applyTagMembership(deck, tags, membership) {
    const norm = (tags || []).map(normTag).filter(Boolean);
    const requested = new Set(norm);
    let changed = false;
    let taggedCount = 0;
    const carte = deck.carte.map((c) => {
      const judgedTags = membership && membership[c.scryfall_id];
      if (!Array.isArray(judgedTags)) return c;
      const matched = judgedTags.filter((t) => requested.has(t));
      // I tag esistenti non richiesti restano; i richiesti si riallineano.
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

  // Filtro semantico della ricerca (§4.1): la chat produce una query Scryfall LARGA più un criterio a parole, e si tengono solo le carte che un LLM economico giudica conformi.
  // Il giudizio (carta, criterio) si cachea permanentemente cross-ricerca: dipende solo dal testo della carta e dal criterio, mai dal mazzo.

  // Due ricerche scritte uguale a meno di spazi e maiuscole condividono i giudizi in cache.
  function normCriterion(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Il Set torna RISTRETTO agli id davvero giudicati, mai quelli inventati dal modello; i giudicati fuori da «keep» sono scarti, informazione cacheabile dal chiamante.
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

  // Separa gli id già decisi in cache per QUESTO criterio (solo i true) da quelli da giudicare, nell'ordine dato.
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
