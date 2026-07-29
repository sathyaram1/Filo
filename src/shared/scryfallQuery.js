// Logica PURA del client Scryfall (DECK-BUILDER-SPEC.md §13.2): costruzione
// query, semplificazione delle carte, parsing dei costi di mana, freschezza
// cache. Niente rete, niente storage — la parte I/O vive in
// src/main/services/scryfall.js. Unit test: tests/unit/scryfallQuery.test.mjs.

(function (global) {
  'use strict';

  const WUBRG = ['W', 'U', 'B', 'R', 'G'];

  // Codice identity per la sintassi Scryfall: ['U','R'] → 'UR' (ordine WUBRG),
  // [] → 'C' (incolore). Colori ignoti vengono scartati.
  function identityCode(colors) {
    const set = new Set((Array.isArray(colors) ? colors : []).map((c) => String(c).toUpperCase()));
    const code = WUBRG.filter((c) => set.has(c)).join('');
    return code || 'C';
  }

  // Vincola una query di ricerca alla color identity del commander (§4): ogni
  // ricerca dentro un mazzo è filtrata con `id<=…` AUTOMATICAMENTE. Se l'utente
  // ha già scritto un vincolo di identity a mano (sintassi ibrida §4: `id:`,
  // `id<=`, `identity…`), la sua query passa invariata — l'esplicito vince.
  function buildSearchQuery(userQuery, identity) {
    const q = String(userQuery || '').trim();
    if (!Array.isArray(identity)) return q;
    if (/(^|\s)(id|identity)\s*[:<>=]/i.test(q)) return q;
    return `${q} id<=${identityCode(identity)}`.trim();
  }

  // Una carta è DENTRO l'identità di colore del commander se OGNI colore della
  // sua color identity è tra i colori del commander (regola Commander §8.4, la
  // stessa del check di legalità). Le incolori (identity vuota) sono sempre
  // ammesse. `commanderColors` null/non-array = nessun commander → nessun
  // vincolo, tutto ammesso. È il filtro DURO sui DATI reali della carta: a
  // differenza di `buildSearchQuery` (che agisce sulla stringa di query e cede
  // a un vincolo `id` esplicito) qui nessuna sintassi può far passare una carta
  // fuori identità — è la rete di sicurezza sui risultati proposti dall'agente.
  function withinIdentity(cardColorIdentity, commanderColors) {
    if (!Array.isArray(commanderColors)) return true;
    const allowed = new Set(commanderColors.map((c) => String(c).toUpperCase()));
    const ci = Array.isArray(cardColorIdentity) ? cardColorIdentity : [];
    return ci.every((c) => allowed.has(String(c).toUpperCase()));
  }

  // '{2}{U}{R}' → ['2','U','R']; stringa vuota/null → [].
  function parseManaCost(cost) {
    if (!cost) return [];
    const out = [];
    const re = /\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(String(cost)))) out.push(m[1]);
    return out;
  }

  // Riduce una carta dell'API Scryfall ai soli campi che l'app usa. Gestisce le
  // carte a due facce (image_uris/mana_cost sulle card_faces, non sulla radice).
  function simplifyCard(api) {
    if (!api || typeof api !== 'object' || !api.id) return null;
    const faces = Array.isArray(api.card_faces) ? api.card_faces : [];
    const front = faces[0] || {};
    const img = api.image_uris || front.image_uris || {};
    // Retro delle carte bifronte (transform / modal DFC): la faccia 2 ha una sua
    // immagine SOLO quando la radice non ha `image_uris` (le split/adventure hanno
    // un'immagine unica e non vanno "girate"). Vuoto per le carte a faccia singola.
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
      artCrop: String(img.art_crop || ''),
      priceEur: Number.isFinite(price) ? price : null,
      // Mana prodotto dalla carta (terre/rock/dork): alimenta "mana prodotto
      // per colore" nelle statistiche (§9.1). Sempre array (vuoto = non
      // produce): `undefined` marca le entry di cache vecchio schema da rifare.
      producedMana: Array.isArray(api.produced_mana) ? api.produced_mana.map(String) : [],
      // Testo Oracle: serve ai giudizi LLM (auto-tag §7, parere §6). Sempre
      // stringa (vuota = carta senza testo): `undefined` marca le entry di
      // cache vecchio schema da rifetchare.
      oracleText: String(oracleText || ''),
      legalCommander: !!(api.legalities && api.legalities.commander === 'legal'),
      scryfallUri: String(api.scryfall_uri || ''),
    };
  }

  // Freschezza di un'entry di cache con TTL. `fetchedAt` ISO o epoch ms.
  function isFresh(fetchedAt, ttlMs, now = Date.now()) {
    const t = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : Number(fetchedAt);
    if (!Number.isFinite(t)) return false;
    return now - t < ttlMs;
  }

  // ── Chat unificata (§3): parsing della risposta dell'agente ───────────────
  // L'agente risponde con un JSON { reply?, query?, cards?, budget?, prob? }.
  // I modelli a volte lo avvolgono in ```json … ``` o aggiungono testo attorno:
  // qui si estrae il primo oggetto JSON valido in modo tollerante. Output
  // sempre normalizzato: { reply, query, cards } sempre presenti; in più
  //   hasBudget/budget  → l'utente ha chiesto di impostare (numero ≥ 0) o
  //                       rimuovere (null) il tetto di budget (§9.2)
  //   prob              → richiesta al calcolatore di probabilità (§9.3):
  //                       { turn: int ≥ 1, needs: [{ tag, n }] } oppure null
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
    // Candidati: contenuto dei fence ```…```, testo intero, primo blocco {...}.
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
        // Budget: presente = intenzione esplicita. null lo rimuove; un numero
        // valido lo imposta; qualsiasi altro valore si ignora. Se il modello
        // riporta il numero come lo scrive l'utente italiano («40,50»), la
        // virgola decimale è valida (stessa tolleranza del campo Budget…).
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
          // Criterio del filtro semantico (§4.1): quando presente, il sistema
          // usa un LLM economico per tenere solo le carte che lo rispettano.
          filter: typeof o.filter === 'string' ? o.filter.trim() : '',
          cards: Array.isArray(o.cards) ? o.cards.map(String).filter(Boolean) : [],
          hasBudget,
          budget,
          prob: normalizeProb(o.prob),
          // Valutazione batch esplicita (§6.1): 'deck' | 'results'. true
          // legacy/sbrigativo dei modelli → 'deck'. Tutto il resto → ''.
          evaluate: o.evaluate === 'deck' || o.evaluate === 'results' ? o.evaluate
            : (o.evaluate === true ? 'deck' : ''),
          // Auto-tag (§7): tag richiesti, normalizzati minuscoli.
          tagWith: Array.isArray(o.tagWith)
            ? o.tagWith.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [],
          // Import via chat (§11.2): lista grezza incollata → nomi indovinati
          // dal modello (typo/italiano/formati strani tollerati) + quantità.
          // MAI scryfall_id qui: la risoluzione la fa il sistema via fuzzy
          // match (mai fidarsi di un id inventato dal modello, §11.2).
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
    // Nessun JSON: il testo grezzo diventa la reply (degradazione garbata).
    return { ...none, reply: raw };
  }

  // Prosa con nomi carta marcati [[Nome Carta]] (§3.5) → segmenti tipizzati:
  // [{ type:'text', text }, { type:'card', name }, …]. Il renderer trasforma i
  // segmenti 'card' in span hoverable risolti via fuzzy. Marcatori vuoti
  // restano testo normale.
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
