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

  // { "keep": [...] } o array nudo, coi NUMERI della lista (1 = judgeIds[0]) o gli id esatti. `null` = illeggibile:
  // non è «nessuna tiene», e salvata come tutte scartate avvelenerebbe la cache per sempre (#382). Basta una voce
  // che non indica una carta della lista (un nome, un numero fuori lista) e non si sa più cosa intendeva il giudice.
  function parseSearchKeep(text, judgeIds) {
    const ids = (judgeIds || []).map(String);
    const allow = new Set(ids);
    const o = firstJson(text);
    if (!o) return null;
    const list = Array.isArray(o) ? o : (Array.isArray(o.keep) ? o.keep : null);
    if (!list) return null;
    const out = new Set();
    for (const it of list) {
      const s = String(it == null ? '' : it).trim();
      if (allow.has(s)) { out.add(s); continue; }
      const n = /^\d+$/.test(s) ? Number(s) : NaN;
      if (!(n >= 1 && n <= ids.length)) return null;
      out.add(ids[n - 1]);
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
  // `keepPrefix`: le chiavi che non cominciano così vengono da un giudice con altre istruzioni e si buttano.
  function updateSearchCache(searchCache, criterion, judged, { keepPrefix = '' } = {}) {
    const key = normCriterion(criterion);
    if (!key) return searchCache && typeof searchCache === 'object' ? searchCache : {};
    const next = {};
    for (const [id, e] of Object.entries(searchCache && typeof searchCache === 'object' ? searchCache : {})) {
      const kept = {};
      for (const [k, v] of Object.entries(e && typeof e === 'object' ? e : {})) {
        if (!keepPrefix || k.startsWith(keepPrefix)) kept[k] = v;
      }
      if (Object.keys(kept).length) next[id] = kept;
    }
    for (const [id, matched] of Object.entries(judged || {})) {
      if (!next[id]) next[id] = {};
      next[id][key] = !!matched;
    }
    return next;
  }

  // Riga della risposta in chat dopo il giudice (§4.1): una scartata non si mostra mai, una non controllata si dichiara
  // (la lista la segna con ?), e le carte trovate oltre quelle arrivate al giudice (`total` > `found`) pure (#382).
  function searchFilterNote({ found, kept, unverified, criterion, why, total = 0 }) {
    const motivo = why ? ` Motivo: ${why}` : '';
    const cap = searchCapNote({ seen: found, total, judged: unverified < found });
    const withCap = (s) => [s, cap].filter(Boolean).join(' ');
    if (found > 0 && unverified >= found) {
      return withCap(`Non sono riuscito a controllare una per una le carte trovate. Qui sotto c'è la ricerca senza filtro, quindi può contenere carte che non c'entrano.${motivo}`);
    }
    if (unverified > 0) {
      return withCap(unverified === 1
        ? `Una delle carte qui sotto, segnata con ?, non l'ho potuta controllare, quindi potrebbe non c'entrare.${motivo}`
        : `${unverified} delle carte qui sotto, segnate con ?, non le ho potute controllare, quindi potrebbero non c'entrare.${motivo}`);
    }
    if (found > 0 && kept === 0) {
      // Il criterio può essere il messaggio intero dell'utente: in chat se ne cita l'inizio, dichiarando il taglio.
      const c = String(criterion || '').trim().replace(/\s+/g, ' ');
      const crit = `«${c.length > 160 ? `${c.slice(0, 159).trimEnd()}…` : c}»`;
      if (total > found) {
        return `Ho controllato una per una le prime ${num(found)} delle ${num(total)} carte trovate, in ordine di costo, e nessuna corrisponde a ${crit}. Per arrivare alle altre aggiungi un vincolo, per esempio un costo massimo o un tipo, o chiedilo con altre parole.`;
      }
      return found === 1
        ? `Ho controllato la carta trovata, ma non corrisponde a ${crit}. Prova a chiederlo con altre parole.`
        : `Ho controllato una per una le ${num(found)} carte trovate, ma nessuna corrisponde a ${crit}. Prova a chiederlo con altre parole.`;
    }
    return cap;
  }

  // Scryfall ne ha trovate più di quante ne sono arrivate in chat: la frase che lo dice, '' se sono tutte lì.
  function searchCapNote({ seen, total, judged }) {
    if (!(total > seen) || !(seen > 0)) return '';
    return judged
      ? `Scryfall ne ha trovate ${num(total)} e ho controllato le prime ${num(seen)}, in ordine di costo. Per arrivare alle altre aggiungi un vincolo, per esempio un costo massimo o un tipo.`
      : `Scryfall ne ha trovate ${num(total)} e qui sotto ci sono le prime ${num(seen)}, in ordine di costo. Per arrivare alle altre aggiungi un vincolo, per esempio un costo massimo o un tipo.`;
  }

  function num(n) { return Number(n).toLocaleString('it-IT'); }

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
    searchFilterNote,
    searchCapNote,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
