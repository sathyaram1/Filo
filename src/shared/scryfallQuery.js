// Logica PURA del client Scryfall (DECK-BUILDER-SPEC.md §13.2): query, semplificazione
// delle carte, costi di mana, freschezza cache. La parte I/O vive in
// src/main/services/scryfall.js.

(function (global) {
  'use strict';

  const WUBRG = ['W', 'U', 'B', 'R', 'G'];

  // Identity per la sintassi Scryfall: ['U','R'] → 'UR' (ordine WUBRG), [] → 'C' (incolore).
  // Colori ignoti scartati.
  function identityCode(colors) {
    const set = new Set((Array.isArray(colors) ? colors : []).map((c) => String(c).toUpperCase()));
    const code = WUBRG.filter((c) => set.has(c)).join('');
    return code || 'C';
  }

  // Ogni ricerca dentro un mazzo è filtrata con `id<=…` (§4), ma se l'utente ha già scritto un
  // vincolo di identity a mano la sua query passa invariata: l'esplicito vince.
  function buildSearchQuery(userQuery, identity) {
    const q = String(userQuery || '').trim();
    if (!Array.isArray(identity)) return q;
    if (/(^|\s)(id|identity)\s*[:<>=]/i.test(q)) return q;
    return `${q} id<=${identityCode(identity)}`.trim();
  }

  // Dentro l'identità se OGNI colore della carta è fra quelli del commander (Commander §8.4).
  // È il filtro DURO sui DATI: qui nessuna sintassi fa passare una carta fuori identità.
  function withinIdentity(cardColorIdentity, commanderColors) {
    if (!Array.isArray(commanderColors)) return true;
    const allowed = new Set(commanderColors.map((c) => String(c).toUpperCase()));
    const ci = Array.isArray(cardColorIdentity) ? cardColorIdentity : [];
    return ci.every((c) => allowed.has(String(c).toUpperCase()));
  }

  function parseManaCost(cost) {
    if (!cost) return [];
    const out = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(String(cost)))) out.push(m[1]);
    return out;
  }

  // Carte a due facce: image_uris e mana_cost stanno sulle card_faces, non sulla radice.
  function simplifyCard(api) {
    if (!api || typeof api !== 'object' || !api.id) return null;
    const faces = Array.isArray(api.card_faces) ? api.card_faces : [];
    const front = faces[0] || {};
    const img = api.image_uris || front.image_uris || {};
    // La faccia 2 ha una sua immagine SOLO quando la radice non ha `image_uris`: le
    // split/adventure hanno un'immagine unica e non vanno «girate».
    const backFace = faces[1] || null;
    const backImg = (!api.image_uris && backFace && backFace.image_uris) ? backFace.image_uris : null;
    const manaCost = api.mana_cost != null && api.mana_cost !== ''
      ? api.mana_cost
      : faces.map((f) => f.mana_cost).filter(Boolean).join(' // ');
    const oracleText = api.oracle_text != null && api.oracle_text !== ''
      ? api.oracle_text
      : faces.map((f) => f.oracle_text).filter(Boolean).join(' // ');
    const priceRaw = api.prices && api.prices.eur;
    const price = priceRaw == null ? null : Number(priceRaw);
    return {
      id: String(api.id),
      name: String(api.name || front.name || ''),
      manaCost: String(manaCost || ''),
      cmc: Number.isFinite(Number(api.cmc)) ? Number(api.cmc) : 0,
      typeLine: String(api.type_line || front.type_line || ''),
      colors: Array.isArray(api.colors) ? api.colors : (Array.isArray(front.colors) ? front.colors : []),
      colorIdentity: Array.isArray(api.color_identity) ? api.color_identity : [],
      image: String(img.normal || img.large || ''),
      backImage: backImg ? String(backImg.normal || backImg.large || '') : '',
      backName: backFace ? String(backFace.name || '') : '',
      artCrop: String(img.art_crop || ''),
      priceEur: Number.isFinite(price) ? price : null,
      // Mana prodotto (terre, rock, dork) per le statistiche §9.1. Sempre array (vuoto = non
      // produce): `undefined` marca le entry di cache vecchio schema da rifare.
      producedMana: Array.isArray(api.produced_mana) ? api.produced_mana.map(String) : [],
      // Testo Oracle per i giudizi LLM (§7, §6). Sempre stringa; `undefined` = cache vecchia.
      oracleText: String(oracleText || ''),
      legalCommander: !!(api.legalities && api.legalities.commander === 'legal'),
      scryfallUri: String(api.scryfall_uri || ''),
    };
  }

  // `fetchedAt` ISO o epoch ms.
  function isFresh(fetchedAt, ttlMs, now = Date.now()) {
    const t = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : Number(fetchedAt);
    if (!Number.isFinite(t)) return false;
    return now - t < ttlMs;
  }

  // Chat unificata (§3): l'agente risponde con un JSON che i modelli a volte avvolgono in
  // ```json o circondano di testo, quindi si estrae il primo oggetto valido.
  function normalizeProb(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const turn = Math.floor(Number(p.turn));
    if (!Number.isFinite(turn) || turn < 1) return null;
    const rawNeeds = p.needs;
    const needs = [];
    if (Array.isArray(rawNeeds)) {
      for (const it of rawNeeds) {
        const tag = String((it && it.tag) || '').trim().toLowerCase();
        const n = Math.floor(Number(it && it.n));
        if (tag && Number.isFinite(n) && n > 0) needs.push({ tag, n });
      }
    } else if (rawNeeds && typeof rawNeeds === 'object') {
      for (const [tag, v] of Object.entries(rawNeeds)) {
        const t = String(tag).trim().toLowerCase();
        const n = Math.floor(Number(v));
        if (t && Number.isFinite(n) && n > 0) needs.push({ tag: t, n });
      }
    }
    return needs.length ? { turn, needs } : null;
  }

  function parseAgentReply(text) {
    const none = {
      reply: '', query: '', filter: '', cards: [], hasBudget: false, budget: null, prob: null, evaluate: '', tagWith: [],
      import: [], commanderName: '',
    };
    const raw = String(text || '').trim();
    if (!raw) return none;
    const candidates = [];
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
    if (fence) candidates.push(fence[1].trim());
    candidates.push(raw);
    const brace = raw.indexOf('{');
    if (brace >= 0) candidates.push(raw.slice(brace, raw.lastIndexOf('}') + 1));
    for (const c of candidates) {
      try {
        const o = JSON.parse(c);
        if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
        // Budget presente = intenzione esplicita: null lo rimuove, un numero valido lo imposta, il
        // resto si ignora. La virgola decimale è valida («40,50»), come nel campo Budget.
        let hasBudget = false; let budget = null;
        if ('budget' in o) {
          const rawB = typeof o.budget === 'string' ? o.budget.trim().replace(',', '.') : o.budget;
          if (o.budget === null) { hasBudget = true; budget = null; }
          else if (Number.isFinite(Number(rawB)) && Number(rawB) >= 0) {
            hasBudget = true; budget = Number(rawB);
          }
        }
        return {
          reply: typeof o.reply === 'string' ? o.reply.trim() : '',
          query: typeof o.query === 'string' ? o.query.trim() : '',
          // Filtro semantico (§4.1): un LLM economico tiene solo le carte che rispettano il
          // criterio.
          filter: typeof o.filter === 'string' ? o.filter.trim() : '',
          cards: Array.isArray(o.cards) ? o.cards.map(String).filter(Boolean) : [],
          hasBudget,
          budget,
          prob: normalizeProb(o.prob),
          // Valutazione batch (§6.1): 'deck' | 'results'; un `true` dei modelli vale 'deck'.
          evaluate: o.evaluate === 'deck' || o.evaluate === 'results' ? o.evaluate
            : (o.evaluate === true ? 'deck' : ''),
          tagWith: Array.isArray(o.tagWith)
            ? o.tagWith.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
          // Import via chat (§11.2): nomi indovinati dal modello, MAI scryfall_id — la risoluzione
          // la fa il sistema via fuzzy match, e di un id inventato dal modello non ci si fida.
          import: Array.isArray(o.import)
            ? o.import.map((it) => ({
                name: typeof (it && it.name) === 'string' ? it.name.trim() : '',
                qty: Math.max(1, Math.floor(Number(it && it.qty)) || 1),
              })).filter((it) => it.name)
            : [],
          commanderName: typeof o.commander === 'string' ? o.commander.trim() : '',
        };
      } catch (_) { /* prova il prossimo candidato */ }
    }
    // Nessun JSON: il testo grezzo diventa la reply.
    return { ...none, reply: raw };
  }

  // Prosa coi nomi marcati [[Nome Carta]] (§3.5) → segmenti tipizzati; il renderer rende i
  // segmenti 'card' span hoverable risolti via fuzzy. Marcatori vuoti restano testo.
  function proseSegments(text) {
    const s = String(text || '');
    const out = [];
    const re = /\[\[([^[\]]+)\]\]/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
      const name = m[1].trim();
      if (name) out.push({ type: 'card', name });
      else out.push({ type: 'text', text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
    return out;
  }

  global.SN_SCRYFALL_Q = {
    WUBRG, identityCode, buildSearchQuery, withinIdentity, parseManaCost, simplifyCard, isFresh,
    parseAgentReply, proseSegments,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
